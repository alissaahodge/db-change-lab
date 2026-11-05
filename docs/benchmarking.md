# How experiments are measured

- Deterministic dataset and seed `42`; identical task sequence and parameters in both phases.
- Baseline has a primary-key index; candidate adds `(customer_id, created_at DESC)`.
- Every client warms one lookup before measuring. Statement latency includes the query round trip and result fetching, excluding `BEGIN`/`ROLLBACK`.
- Throughput includes connection setup, warmup, transaction commands, and rollback. It is not simply inverse median query latency.
- Inserts use unique temporary IDs and are **rolled back** to keep both phases on the same rows. This measures statement execution/index maintenance, **not durable commit throughput**.
- p95 uses nearest rank. No statistical significance claim or production-speedup prediction is made.
- Each trial starts each phase with fresh identical rows. Odd trials run baseline first and even trials run the indexed phase first. Alternation reduces systematic ordering bias, but shared caches, checkpoints, and scheduling can still affect measurements.
- Overall latency summaries pool operation samples. Overall throughput divides total operations by total elapsed phase time. The results table shows median latency, p95 latency, and throughput for each trial. Build time is the median across candidate builds; index size and plans are from the final trial.
- Execution plans are separately sampled for customer `1`; they do not represent every operation. `EXPLAIN ANALYZE` itself executes the query.
- Synthetic uniform customers and correlated generated data do not reproduce a production workload's distributions or cardinalities.
- Statement timeout is 15 seconds; lock timeout is 2 seconds. There is currently no overall job timeout/cancel control.
- A hard process termination may leave a `lab_<uuid>` schema behind. Restarted in-flight jobs are marked interrupted; automatic orphan recovery is not implemented.
- Arbitrary SQL, schema import, index suggestions, lock-contention analysis, and actual customer-data cloning are not implemented.

## PostgreSQL references

- [EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)
- [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)
