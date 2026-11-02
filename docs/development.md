# Development guide

## Run without Docker

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

## Frontend formatting

From the repository root:

```bash
npm run format --prefix frontend
npm run format:check --prefix frontend
```

Prettier formats TypeScript, JSX, CSS, HTML, and JSON. CI checks formatting before building the frontend.

`main.tsx` mounts the app. `App.tsx` owns shared state and API calls; the three screens live in `src/pages`. Shared response types and the API client live in `types.ts` and `api.ts`.

## Connecting to a database from Docker

The connection is opened by the backend. If the backend runs in Docker, `localhost` means the app container, not your computer.

| Database location | Host in the connection form |
| --- | --- |
| Included lab database | `postgres` |
| Your computer, using Docker Desktop | `host.docker.internal` |
| Another server | Its hostname or IP address, reachable from the backend |

For the included database, use port `5432`, database/user `lab`, the password from `.env`, and TLS disabled. On Linux, connecting to the host may require a Docker host-gateway mapping.

Remote connections require TLS by default. Full verification also checks the certificate and hostname; it requires a trusted CA certificate on the backend. Encryption-required mode alone does not verify server identity.

## Local database settings

The setup script creates `.env` only if it does not exist. Existing settings are preserved. You can also supply `LAB_DB_PASSWORD` through your shell environment.

Keep the password consistent when reusing the PostgreSQL volume: changing an environment variable does not rotate the password of an initialized database. Both database data and experiment history persist in Docker volumes.

## Architecture

The same-origin React frontend calls FastAPI. FastAPI validates and bounds configuration, then dispatches work to a single experiment executor. A bounded set of client threads connects to the selected PostgreSQL test database. Each run owns its generated schema. Results are persisted to SQLite independently of the database under test. The browser polls run history while a job is active.

The current backend must run as **one process / one Uvicorn worker**: the job lock and connection sessions are process-local. A durable queue and external credential storage are intentionally outside this milestone.
