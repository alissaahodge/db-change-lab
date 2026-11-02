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
            admin.execute(sql.SQL('CREATE TABLE {} (id bigint PRIMARY KEY, customer_id int NOT NULL, status text NOT NULL, total_cents int NOT NULL, created_at timestamp NOT NULL)').format(table))
            admin.execute(sql.SQL("INSERT INTO {} SELECT i, 1+(i%%1000), CASE WHEN i%%5=0 THEN 'pending' ELSE 'completed' END, 100+(i%%10000), timestamp '2026-01-01' + (i%%365)*interval '1 day' FROM generate_series(1,%s) i").format(table), (rows,))
            admin.execute(sql.SQL('ANALYZE {}').format(table))
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
                return {"all": summarize([v for _,v in measurements], seconds),
                        "reads": summarize([v for w,v in measurements if not w], seconds) if any(not w for w,_ in measurements) else None,
                        "writes": summarize([v for w,v in measurements if w], seconds) if any(w for w,_ in measurements) else None,
                        "elapsed_seconds": round(seconds, 3), "plan": plan}

            baseline = phase('Measuring baseline')
            progress('Building composite index')
            started = time.perf_counter()
            admin.execute(sql.SQL('CREATE INDEX orders_customer_created_idx ON {} (customer_id, created_at DESC)').format(table))
            build_ms = (time.perf_counter()-started)*1000
            index_bytes = admin.execute('SELECT pg_relation_size(%s::regclass)', (schema+'.orders_customer_created_idx',)).fetchone()[0]
            candidate = phase('Measuring candidate')
            return {"baseline": baseline, "candidate": candidate, "index_bytes": index_bytes,
                    "build_ms": round(build_ms, 3), "settings": settings,
                    "index_sql": 'CREATE INDEX ON orders (customer_id, created_at DESC);',
                    "methodology": 'Fixed seed 42; identical generated rows and task sequence; per-connection warmup; client-side statement latency; transactions rolled back; baseline precedes candidate. Throughput includes connection setup and rollback. No durable write/commit throughput measured. Cache and order effects remain; repeat experiments before drawing conclusions.'}
        finally:
            progress('Cleaning up temporary schema')
            admin.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


def rng_id():
    return uuid.uuid4().int % (2**62) + 1
