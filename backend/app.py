import json
import os
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr
from psycopg import sql
from .custom import compile_experiment
from .runner import ExperimentCancelled, connect, run

app = FastAPI(title='DB Change Lab', version='0.1.0')
DATA = Path(os.getenv('LAB_DATA_DIR', 'data'))
DATA.mkdir(exist_ok=True)
DB = DATA / 'experiments.sqlite3'
with sqlite3.connect(DB) as db:
    db.execute('CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, created TEXT DEFAULT CURRENT_TIMESTAMP, state TEXT, stage TEXT, result TEXT)')
    db.execute("UPDATE experiments SET state='interrupted', stage='Server restarted; rerun experiment' WHERE state IN ('queued','running','cancelling')")
pool = ThreadPoolExecutor(max_workers=1)
active_lock = threading.Lock()
active_runs: dict[str, threading.Event] = {}
sessions = {}
sessions_lock = threading.Lock()

class Connection(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=5432, ge=1, le=65535)
    dbname: str = Field(min_length=1, max_length=128)
    user: str = Field(min_length=1, max_length=128)
    password: SecretStr
    sslmode: Literal['disable', 'require', 'verify-full'] = 'require'

class CustomWorkload(BaseModel):
    query: str = Field(max_length=512)
    index: str = Field(max_length=256)


class Experiment(BaseModel):
    custom_workload: CustomWorkload | None = None
    rows: int = Field(default=100000, ge=10000, le=1000000)
    clients: int = Field(default=4, ge=1, le=16)
    trials: int = Field(default=1, ge=1, le=6)
    samples: int = Field(default=200, ge=20, le=2000)
    write_pct: int = Field(default=20, ge=0, le=100)
    connection_id: str | None = Field(default=None, max_length=64)
    allow_test_schema: bool = False

@app.middleware('http')
async def local_origin(request: Request, call_next):
    # Local-only service. Reject browser cross-origin mutations (including DNS rebinding).
    if request.headers.get('host','').split(':')[0] not in ('127.0.0.1', 'localhost', 'testserver'):
        return JSONResponse({'detail':'Local access only'}, status_code=403)
    if request.method == 'POST':
        origin = request.headers.get('origin')
        if origin and origin != str(request.base_url).rstrip('/'):
            return JSONResponse({'detail':'Cross-origin request rejected'}, status_code=403)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    # Pydantic's default errors can include submitted values, including passwords.
    errors = [
        {key: item[key] for key in ('loc', 'msg', 'type')}
        for item in error.errors()
    ]
    return JSONResponse({'detail': errors}, status_code=422)


def lab_configured():
    return bool(os.getenv('LAB_DB_HOST') and os.getenv('LAB_DB_PASSWORD'))


@app.get('/api/health')
def health():
    return {'ok': True, 'lab_configured': lab_configured()}

@app.post('/api/connections/test')
def test_connection(body: Connection):
    config = body.model_dump()
    config['password'] = body.password.get_secret_value()
    try:
        with connect(config) as conn:
            conn.execute('SET default_transaction_read_only = on')
            version = conn.execute('SHOW server_version').fetchone()[0]
            tables = conn.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2 LIMIT 100").fetchall()
        token = uuid.uuid4().hex
        with sessions_lock:
            now = time.monotonic()
            expired = [key for key, value in sessions.items() if value[0] < now]
            for key in expired:
                del sessions[key]
            if len(sessions) >= 10:
                del sessions[next(iter(sessions))]
            sessions[token] = (now + 1800, config)
        def expire():
            with sessions_lock:
                sessions.pop(token, None)
        timer = threading.Timer(1800, expire)
        timer.daemon = True
        timer.start()
        return {'connection_id': token, 'version': version, 'tables': [{'schema':s,'name':n} for s,n in tables]}
    except psycopg.Error:
        # Driver errors can contain hostnames and user names; never echo them.
        raise HTTPException(400, 'Connection failed. Check credentials, network reachability, and TLS settings.') from None


def update(id, state, stage, result=None):
    with sqlite3.connect(DB) as db:
        db.execute('UPDATE experiments SET state=?, stage=?, result=? WHERE id=?', (state, stage, json.dumps(result) if result else None, id))

@app.get('/api/experiments')
def experiments():
    with sqlite3.connect(DB) as db:
        entries = db.execute('SELECT id,created,state,stage,result FROM experiments ORDER BY created DESC, rowid DESC LIMIT 50').fetchall()
    return [dict(id=i, created=c, state=s, stage=p, result=json.loads(r) if r else None) for i,c,s,p,r in entries]

@app.post('/api/experiments', status_code=202)
def create_experiment(body: Experiment):
    if body.custom_workload:
        try:
            compile_experiment(body.custom_workload.query, body.custom_workload.index, sql.Identifier('orders'))
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        if body.write_pct:
            raise HTTPException(422, 'Custom workloads require a read-only workload mix.')
    if body.connection_id:
        if not body.allow_test_schema:
            raise HTTPException(400, 'Explicit test-schema permission is required.')
        with sessions_lock:
            session = sessions.get(body.connection_id)
            if not session or session[0] < time.monotonic():
                sessions.pop(body.connection_id, None)
                raise HTTPException(409, 'Connection expired. Test your connection again.')
            config = session[1].copy()
    else:
        if not lab_configured():
            raise HTTPException(409, 'Start the dedicated PostgreSQL lab using Docker Compose first, or select a verified test connection.')
        try:
            port = int(os.getenv('LAB_DB_PORT', '5432'))
            if not 1 <= port <= 65535:
                raise ValueError
        except ValueError:
            raise HTTPException(409, 'LAB_DB_PORT must be a number from 1 to 65535.') from None
        config = dict(host=os.environ['LAB_DB_HOST'], port=port, dbname=os.getenv('LAB_DB_NAME','lab'), user=os.getenv('LAB_DB_USER','lab'), password=os.environ['LAB_DB_PASSWORD'], sslmode=os.getenv('LAB_DB_SSLMODE','disable'))
    with active_lock:
        if active_runs:
            raise HTTPException(409, 'An experiment is already running.')
        id = uuid.uuid4().hex
        stop = threading.Event()
        with sqlite3.connect(DB) as db:
            db.execute("INSERT INTO experiments(id,state,stage) VALUES (?,'queued','Waiting for runner')", (id,))
        active_runs[id] = stop

    def progress(stage):
        with active_lock:
            if not stop.is_set():
                update(id, 'running', stage)

    def execute():
        try:
            result = run(
                config, body.model_dump(exclude={'connection_id', 'allow_test_schema'}),
                progress, stop=stop,
            )
            state, stage = 'completed', 'Experiment complete'
        except ExperimentCancelled:
            result = None
            state, stage = 'cancelled', 'Experiment cancelled'
        except Exception:
            result = None
            state = 'failed'
            stage = 'Experiment failed. Check lab availability and database privileges. No connection details were saved.'
        with active_lock:
            try:
                if stop.is_set() and state == 'completed':
                    state, stage, result = 'cancelled', 'Experiment cancelled', None
                update(id, state, stage, result)
            finally:
                active_runs.pop(id)

    try:
        pool.submit(execute)
    except Exception:
        with active_lock:
            try:
                update(id, 'failed', 'The experiment could not be scheduled.')
            finally:
                active_runs.pop(id)
        raise
    return {'id': id}


@app.post('/api/experiments/{id}/cancel', status_code=202)
def cancel_experiment(id: str):
    with active_lock:
        stop = active_runs.get(id)
        if stop is None:
            with sqlite3.connect(DB) as db:
                exists = db.execute('SELECT 1 FROM experiments WHERE id=?', (id,)).fetchone()
            if not exists:
                raise HTTPException(404, 'Experiment not found.')
            raise HTTPException(409, 'This experiment has already stopped.')
        if not stop.is_set():
            update(id, 'cancelling', 'Waiting for active database work and schema cleanup')
            stop.set()
    return {'state': 'cancelling'}


DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST/'assets'), name='assets')
    @app.get('/')
    def index():
        return FileResponse(DIST/'index.html')
