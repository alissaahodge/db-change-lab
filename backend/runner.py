"""Bounded experiments on generated data; executes only generated or restricted SQL."""
import math
import random
import statistics
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg
from psycopg import sql
from .custom import INDEX_NAME, compile_experiment


def percentile(values, q):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * q) - 1)]


def summarize(samples, seconds):
    return {"operations": len(samples), "median_ms": round(statistics.median(samples), 3),
            "p95_ms": round(percentile(samples, .95), 3),
            "throughput": round(len(samples) / seconds, 2)}


def connect(config):
    return psycopg.connect(**config, connect_timeout=5, autocommit=True,
                           options="-c statement_timeout=15000 -c lock_timeout=2000")


class ExperimentCancelled(Exception):
    """The runner stopped at a cancellation checkpoint."""


def run(config, settings, progress, *, stop=None):
    def check_cancelled():
        if stop is not None and stop.is_set():
            raise ExperimentCancelled

    check_cancelled()
    schema = 'lab_' + uuid.uuid4().hex
    table = sql.Identifier(schema, 'orders')
    rows, clients, samples = settings['rows'], settings['clients'], settings['samples']
    custom = settings.get('custom_workload')
    write_pct = 0 if custom else settings['write_pct']
    tasks = []
    rng = random.Random(42)
    for _ in range(samples):
        tasks.append((rng.randrange(100) < write_pct, rng.randrange(1, 1001)))
    progress('Preparing generated orders')
    with connect(config) as admin:
        check_cancelled()
        admin.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        try:
            if custom:
                read, create_index = compile_experiment(custom['query'], custom['index'], table)
            else:
                read = sql.SQL('SELECT id, total_cents, created_at FROM {} WHERE customer_id=%s ORDER BY created_at DESC LIMIT 20').format(table)
                create_index = sql.SQL('CREATE INDEX {} ON {} (customer_id, created_at DESC)').format(sql.Identifier(INDEX_NAME), table)

            def parameters(customer):
                return None if custom else (customer,)

            def phase(label):
                check_cancelled()
                progress(label)
                def worker(part):
                    measurements = []
                    check_cancelled()
                    with connect(config) as conn:
                        check_cancelled()
                        # Warm each connection and query path; warmup excluded.
                        conn.execute(read, parameters(1)).fetchall()
                        for write, customer in part:
                            check_cancelled()
                            # Roll back every operation so both phases use identical rows.
                            conn.execute('BEGIN')
                            try:
                                check_cancelled()
                                started = time.perf_counter()
                                if write:
                                    # Distinct IDs avoid contention unrelated to the proposed index.
                                    conn.execute(sql.SQL("INSERT INTO {} VALUES (%s,%s,'pending',2500,timestamp '2026-06-01')").format(table), (-rng_id(), customer))
                                else:
                                    conn.execute(read, parameters(customer)).fetchall()
                                elapsed = (time.perf_counter()-started)*1000
                                measurements.append((write, elapsed))
                            finally:
                                conn.execute('ROLLBACK')
                    return measurements
                started = time.perf_counter()
                with ThreadPoolExecutor(max_workers=clients) as pool:
                    parts = list(pool.map(worker, [tasks[i::clients] for i in range(clients)]))
                seconds = time.perf_counter()-started
                measurements = [x for part in parts for x in part]
                check_cancelled()
                plan = admin.execute(sql.SQL('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ') + read, parameters(1)).fetchone()[0][0]
                return measurements, seconds, plan

            def report(measurements, seconds):
                reads = [value for write, value in measurements if not write]
                writes = [value for write, value in measurements if write]
                return {
                    "all": summarize([value for _, value in measurements], seconds),
                    "reads": summarize(reads, seconds) if reads else None,
                    "writes": summarize(writes, seconds) if writes else None,
                    "elapsed_seconds": round(seconds, 3),
                }

            trial_count = settings.get('trials', 1)
            trials = []
            phases = {"baseline": [], "candidate": []}
            builds = []
            for number in range(1, trial_count + 1):
                order = ["baseline", "candidate"] if number % 2 else ["candidate", "baseline"]
                trial = {"order": order}
                prefix = f'Trial {number}/{trial_count}: ' if trial_count > 1 else ''
                for kind in order:
                    progress(prefix + f'Preparing {kind} orders')
                    check_cancelled()
                    admin.execute(sql.SQL('CREATE TABLE {} (id bigint PRIMARY KEY, customer_id int NOT NULL, status text NOT NULL, total_cents int NOT NULL, created_at timestamp NOT NULL)').format(table))
                    check_cancelled()
                    admin.execute(sql.SQL("INSERT INTO {} SELECT i, 1+(i%%1000), CASE WHEN i%%5=0 THEN 'pending' ELSE 'completed' END, 100+(i%%10000), timestamp '2026-01-01' + (i%%365)*interval '1 day' FROM generate_series(1,%s) i").format(table), (rows,))
                    check_cancelled()
                    admin.execute(sql.SQL('ANALYZE {}').format(table))
                    check_cancelled()
                    if kind == "candidate":
                        progress(prefix + 'Building composite index')
                        check_cancelled()
                        started = time.perf_counter()
                        admin.execute(create_index)
                        builds.append((time.perf_counter() - started) * 1000)
                        check_cancelled()
                        index_bytes = admin.execute(
                            'SELECT pg_relation_size(%s::regclass)',
                            (schema + '.' + INDEX_NAME,),
                        ).fetchone()[0]
                    measurements, seconds, plan = phase(prefix + f'Measuring {kind}')
                    phases[kind].append((measurements, seconds, plan))
                    trial[kind] = summarize([value for _, value in measurements], seconds)
                    check_cancelled()
                    admin.execute(sql.SQL('DROP TABLE {}').format(table))
                trials.append(trial)

            combined = {}
            for kind, results in phases.items():
                measurements = [sample for phase_samples, _, _ in results for sample in phase_samples]
                seconds = sum(elapsed for _, elapsed, _ in results)
                combined[kind] = report(measurements, seconds)
                combined[kind]["plan"] = results[-1][2]

            return {
                **combined,
                "trials": trials,
                "index_bytes": index_bytes,
                "build_ms": round(statistics.median(builds), 3),
                "settings": settings,
                "index_sql": custom['index'] if custom else 'CREATE INDEX ON orders (customer_id, created_at DESC);',
                "methodology": (
                    'Fixed seed 42; fresh identical rows per phase; identical task sequence; '
                    'per-connection warmup; client-side statement latency; transactions rolled back. '
                    'Phase order alternates across trials. Latencies pool samples; throughput divides '
                    'total operations by total phase time, including connection setup and rollback. '
                    'Build time is the median; plans and index size come from the last trial. '
                    'Shared caches and background load can still affect results.'
                ),
            }
        finally:
            try:
                progress('Cleaning up temporary schema')
            finally:
                # A history/progress failure must not prevent database cleanup.
                admin.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


def rng_id():
    return uuid.uuid4().int % (2**62) + 1
