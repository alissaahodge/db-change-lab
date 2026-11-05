"""Bounded experiments on generated data; never accepts arbitrary SQL."""
import math
import random
import statistics
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg
from psycopg import sql


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


def run(config, settings, progress):
    schema = 'lab_' + uuid.uuid4().hex
    table = sql.Identifier(schema, 'orders')
    rows, clients, samples = settings['rows'], settings['clients'], settings['samples']
    write_pct = settings['write_pct']
    tasks = []
    rng = random.Random(42)
    for _ in range(samples):
        tasks.append((rng.randrange(100) < write_pct, rng.randrange(1, 1001)))
    progress('Preparing generated orders')
    with connect(config) as admin:
        admin.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        try:
            read = sql.SQL('SELECT id, total_cents, created_at FROM {} WHERE customer_id=%s ORDER BY created_at DESC LIMIT 20').format(table)

            def phase(label):
                progress(label)
                def worker(part):
                    measurements = []
                    with connect(config) as conn:
                        # Warm each connection and query path; warmup excluded.
                        conn.execute(read, (1,)).fetchall()
                        for write, customer in part:
                            # Roll back every operation so both phases use identical rows.
                            conn.execute('BEGIN')
                            try:
                                started = time.perf_counter()
                                if write:
                                    # Distinct IDs avoid contention unrelated to the proposed index.
                                    conn.execute(sql.SQL("INSERT INTO {} VALUES (%s,%s,'pending',2500,timestamp '2026-06-01')").format(table), (-rng_id(), customer))
                                else:
                                    conn.execute(read, (customer,)).fetchall()
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
                plan = admin.execute(sql.SQL('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ') + read, (1,)).fetchone()[0][0]
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
                    admin.execute(sql.SQL('CREATE TABLE {} (id bigint PRIMARY KEY, customer_id int NOT NULL, status text NOT NULL, total_cents int NOT NULL, created_at timestamp NOT NULL)').format(table))
                    admin.execute(sql.SQL("INSERT INTO {} SELECT i, 1+(i%%1000), CASE WHEN i%%5=0 THEN 'pending' ELSE 'completed' END, 100+(i%%10000), timestamp '2026-01-01' + (i%%365)*interval '1 day' FROM generate_series(1,%s) i").format(table), (rows,))
                    admin.execute(sql.SQL('ANALYZE {}').format(table))
                    if kind == "candidate":
                        progress(prefix + 'Building composite index')
                        started = time.perf_counter()
                        admin.execute(sql.SQL('CREATE INDEX orders_customer_created_idx ON {} (customer_id, created_at DESC)').format(table))
                        builds.append((time.perf_counter() - started) * 1000)
                        index_bytes = admin.execute(
                            'SELECT pg_relation_size(%s::regclass)',
                            (schema + '.orders_customer_created_idx',),
                        ).fetchone()[0]
                    measurements, seconds, plan = phase(prefix + f'Measuring {kind}')
                    phases[kind].append((measurements, seconds, plan))
                    trial[kind] = summarize([value for _, value in measurements], seconds)
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
                "index_sql": 'CREATE INDEX ON orders (customer_id, created_at DESC);',
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
