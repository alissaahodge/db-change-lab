# DB Change Lab

**Test an index. See the tradeoffs. Keep the evidence.**

A local-first PostgreSQL experiment workbench with a React + TypeScript interface. Run a deterministic orders workload before and after adding a composite index, then compare latency, throughput, raw execution plans, index storage, and build time.

> Early development. [CI](https://github.com/alissaahodge/db-change-lab/actions) validates PostgreSQL experiments and schema cleanup, the frontend build, and the packaged Docker application. This is an exploratory benchmarking tool, not a production migration approval system.

## Interface

Actual screenshots from this build; no fabricated benchmark results.

![Experiment configuration and results workspace](docs/experiments.png)

![PostgreSQL connection form](docs/connections.png)

## Run locally

Requirements: Python 3, Docker Engine, and Docker Compose.

```bash
python3 scripts/setup.py
docker compose up --build
```

Open **http://localhost:8000**. The app and PostgreSQL run together; only the app is published, bound to the loopback interface. The setup script creates a random local database password in an ignored `.env` file and preserves existing settings. You can also set `LAB_DB_PASSWORD` yourself; no database password is committed to the repository. Keep the same password when reusing the PostgreSQL volume, because changing an environment variable does not rotate an initialized database password. Database and experiment history use Docker volumes.

1. Choose the row count, client concurrency, operation count, and read/write mix.
2. Run the baseline → index build → candidate experiment.
3. Compare median/p95 latency and total phase throughput; inspect raw plans.
4. Select previous runs from local history.

### Connect your own database

Open **Connections** and enter the host, port, database name, username, password, and TLS mode. **Test connection** runs a read-only session that reads the server version and up to 100 visible table names. It does not run a benchmark.

To use that connection for an experiment, explicitly mark it as a **test database**, then choose **Use for experiments**. The account needs permission to create schemas. The runner creates generated orders in a unique `lab_<uuid>` schema and drops that schema afterward. Existing application tables are neither benchmarked nor changed. Importing your real schema/workload is a future milestone.

Credentials are kept only in backend memory for a 30-minute session; the UI clears the password field after testing. Credentials and connection targets are never written to experiment history or browser storage. Restarting the backend invalidates sessions. TLS defaults to encryption required; choose full verification when the backend has the appropriate trusted CA certificate. Encryption-required mode alone does not verify the server identity.

When the backend runs in Docker, `localhost` in the connection form refers to the **app container**. For the included database use `postgres`, port `5432`, database/user `lab`, the configured password, and TLS disabled. For a database on a Docker Desktop host, use `host.docker.internal`; Linux may require an explicit host-gateway mapping. Remote databases must be reachable from the backend machine/container.

This is a single-user local tool, without remote authentication or multi-user isolation. Keep its port on loopback. Database tests and schema inspection still consume database resources; use a dedicated test database for experiments.

## What is implemented

- React/TypeScript interface with responsive configuration, results, connection testing, and methodology views.
- Python/FastAPI API; psycopg connects to PostgreSQL.
- Bounded workloads: 10k–1m orders, 1–16 clients, 20–2,000 operations per phase.
- Fixed seed and parameterized queries; a fixed candidate composite B-tree index.
- Background execution with one active experiment per backend process.
- Median/p95 statement latency, phase throughput, read/write breakdown, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, build time, and index size.
- SQLite experiment history; temporary schema cleanup on success and ordinary failure.
- Session-only custom connection selection with explicit schema-write permission.

## Architecture

The same-origin React frontend calls FastAPI. FastAPI validates and bounds configuration, then dispatches work to a single experiment executor. A bounded set of client threads connects to the selected PostgreSQL test database. Each run owns its generated schema. Results are persisted to SQLite independently of the database under test. The browser polls run history while a job is active.

The current backend must run as **one process / one Uvicorn worker**: the job lock and connection sessions are process-local. A durable queue and external credential storage are intentionally outside this milestone.

## Benchmark methodology and limitations

- Deterministic dataset and seed `42`; identical task sequence and parameters in both phases.
- Baseline has a primary-key index; candidate adds `(customer_id, created_at DESC)`.
- Every client warms one lookup before measuring. Statement latency includes the query round trip and result fetching, excluding `BEGIN`/`ROLLBACK`.
- Throughput includes connection setup, warmup, transaction commands, and rollback. It is not simply inverse median query latency.
- Inserts use unique temporary IDs and are **rolled back** to keep both phases on the same rows. This measures statement execution/index maintenance, **not durable commit throughput**.
- p95 uses nearest rank. No statistical significance claim or production-speedup prediction is made.
- Baseline always precedes candidate: cache, checkpoint, scheduling, and order effects remain. Repeat measurements before interpreting small differences. Alternating run order and multiple trials are planned.
- Execution plans are separately sampled for customer `1`; they do not represent every operation. `EXPLAIN ANALYZE` itself executes the query.
- Synthetic uniform customers and correlated generated data do not reproduce a production workload's distributions or cardinalities.
- Statement timeout is 15 seconds; lock timeout is 2 seconds. There is currently no overall job timeout/cancel control.
- A hard process termination may leave a `lab_<uuid>` schema behind. Restarted in-flight jobs are marked interrupted; automatic orphan recovery is not implemented.
- Arbitrary SQL, schema import, index suggestions, lock-contention analysis, and actual customer-data cloning are not implemented.

## Development and checks

Python 3.12 and Node 22+:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
npm ci --prefix frontend
npm run build --prefix frontend
python -m pytest tests -q
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

The UI is served from `frontend/dist`. Set `LAB_DB_HOST`, `LAB_DB_PORT`, `LAB_DB_NAME`, `LAB_DB_USER`, `LAB_DB_PASSWORD`, and `LAB_DB_SSLMODE` for a dedicated default test database, or use Connections in the UI. Without either, you can inspect the interface but cannot run a benchmark.

Run the integration test only against a disposable PostgreSQL database:

```bash
LAB_TEST_DSN='postgresql://lab:password@localhost:5432/lab' python -m pytest tests/test_postgres.py -q
```

The GitHub Actions workflow provisions PostgreSQL 17 and runs the integration test, API/unit suite, and frontend build. It also builds the Docker Compose app and runs `scripts/smoke.py` to verify the packaged frontend, an API-driven background experiment, connection testing, and an experiment on an explicitly selected test connection.

## Next milestones

- Expand PostgreSQL integration coverage and capture measured-results screenshots.
- Repeated trials with alternating order and variability reporting.
- Cancellation, progress counts, and durable background job recovery.
- Structured query-plan comparison and result export.
- Schema/workload import with explicit handling for sensitive data.

## References

- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html)
- [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)
