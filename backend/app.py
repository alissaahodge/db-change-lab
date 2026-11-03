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
from .runner import connect, run

app = FastAPI(title='DB Change Lab', version='0.1.0')
DATA = Path(os.getenv('LAB_DATA_DIR', 'data'))
DATA.mkdir(exist_ok=True)
DB = DATA / 'experiments.sqlite3'
with sqlite3.connect(DB) as db:
    db.execute('CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, created TEXT DEFAULT CURRENT_TIMESTAMP, state TEXT, stage TEXT, result TEXT)')
    db.execute("UPDATE experiments SET state='interrupted', stage='Server restarted; rerun experiment' WHERE state IN ('queued','running')")
pool = ThreadPoolExecutor(max_workers=1)
busy = threading.Lock()
sessions = {}
sessions_lock = threading.Lock()

class Connection(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=5432, ge=1, le=65535)
    dbname: str = Field(min_length=1, max_length=128)
    user: str = Field(min_length=1, max_length=128)
    password: SecretStr
    sslmode: Literal['disable', 'require', 'verify-full'] = 'require'

class Experiment(BaseModel):
    rows: int = Field(default=100000, ge=10000, le=1000000)
    clients: int = Field(default=4, ge=1, le=16)
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
    if not busy.acquire(blocking=False):
        raise HTTPException(409, 'An experiment is already running.')
    id = uuid.uuid4().hex
    try:
        with sqlite3.connect(DB) as db:
            db.execute("INSERT INTO experiments(id,state,stage) VALUES (?,'queued','Waiting for runner')", (id,))
        def execute():
            try:
                result = run(config, body.model_dump(exclude={'connection_id', 'allow_test_schema'}), lambda stage: update(id, 'running', stage))
                update(id, 'completed', 'Experiment complete', result)
            except Exception:
                update(id, 'failed', 'Experiment failed. Check lab availability and database privileges. No connection details were saved.')
            finally:
                busy.release()
        pool.submit(execute)
    except Exception:
        busy.release()
        raise
    return {'id': id}

DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST/'assets'), name='assets')
    @app.get('/')
    def index():
        return FileResponse(DIST/'index.html')
