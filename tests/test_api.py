import importlib
import time
from unittest.mock import MagicMock
import psycopg
import pytest
from fastapi.testclient import TestClient

module = importlib.import_module('backend.app')
client = TestClient(module.app)

def test_cross_origin_and_rebinding_are_rejected():
    assert client.post('/api/connections/test', json={}, headers={'origin':'https://other.example'}).status_code == 403
    assert client.get('/api/health', headers={'host':'other.example'}).status_code == 403

def test_secrets_are_not_echoed_on_connection_failure(monkeypatch):
    def fail(_): raise psycopg.OperationalError('secret-value backend details')
    monkeypatch.setattr(module, 'connect', fail)
    r=client.post('/api/connections/test', json=dict(host='localhost', user='lab', dbname='lab', password='secret-value', sslmode='disable'))
    assert r.status_code == 400
    assert 'secret-value' not in r.text
    assert 'backend details' not in r.text

def test_connection_is_read_only_and_credentials_are_session_only(monkeypatch):
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value=('17.0',)
    conn.execute.return_value.fetchall.return_value=[('public','orders')]
    context=MagicMock()
    context.__enter__.return_value=conn
    monkeypatch.setattr(module, 'connect', lambda _:context)
    r=client.post('/api/connections/test', json=dict(host='localhost', user='lab', dbname='lab', password='secret-value'))
    assert r.status_code == 200
    data=r.json()
    assert data['tables']==[{'schema':'public','name':'orders'}]
    assert data['connection_id']
    assert 'secret-value' not in r.text
    assert conn.execute.call_args_list[0].args[0]=='SET default_transaction_read_only = on'
    assert 'secret-value' not in client.get('/api/experiments').text
    module.sessions.pop(data['connection_id'])

def test_custom_target_requires_explicit_permission():
    assert client.post('/api/experiments', json={'connection_id':'unknown'}).status_code == 400

def test_expired_connection_is_rejected():
    module.sessions['expired']=(time.monotonic()-1, {})
    r=client.post('/api/experiments', json={'connection_id':'expired','allow_test_schema':True})
    assert r.status_code == 409
    assert 'expired' not in module.sessions

def test_missing_lab_returns_actionable_error(monkeypatch):
    monkeypatch.delenv('LAB_DB_HOST', raising=False)
    r=client.post('/api/experiments', json={})
    assert r.status_code==409
    assert 'Docker Compose' in r.json()['detail']
