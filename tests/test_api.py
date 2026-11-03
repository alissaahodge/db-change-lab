"""API behavior tests using fake database connections unless stated otherwise."""
import importlib
import time
from unittest.mock import MagicMock

import psycopg
from fastapi.testclient import TestClient

module = importlib.import_module('backend.app')
client = TestClient(module.app)


def test_cross_origin_and_rebinding_are_rejected():
    """Reject untrusted Origin and Host headers before processing request bodies."""
    response = client.post(
        '/api/connections/test', json={}, headers={'origin': 'https://other.example'}
    )
    assert response.status_code == 403
    assert client.get('/api/health', headers={'host': 'other.example'}).status_code == 403


def test_secrets_are_not_echoed_on_connection_failure(monkeypatch):
    """Return a useful connection error without leaking driver details or credentials.

    Args:
        monkeypatch: Pytest fixture used to replace the database connection function
            with one that raises a driver error containing sensitive text.
    """
    def fail(_):
        raise psycopg.OperationalError('secret-value backend details')

    monkeypatch.setattr(module, 'connect', fail)
    response = client.post('/api/connections/test', json={
        'host': 'localhost',
        'user': 'lab',
        'dbname': 'lab',
        'password': 'secret-value',
        'sslmode': 'disable',
    })
    assert response.status_code == 400
    assert 'secret-value' not in response.text
    assert 'backend details' not in response.text


def test_connection_is_read_only_and_credentials_are_session_only(monkeypatch):
    """Inspect a connection read-only and return a session ID without its password.

    Args:
        monkeypatch: Pytest fixture used to substitute a fake successful PostgreSQL
            connection, so this test does not require a running database.

    The response should list visible tables, and neither it nor experiment history
    should contain the submitted password.
    """
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = ('17.0',)
    connection.execute.return_value.fetchall.return_value = [('public', 'orders')]
    context = MagicMock()
    context.__enter__.return_value = connection
    monkeypatch.setattr(module, 'connect', lambda _: context)

    response = client.post('/api/connections/test', json={
        'host': 'localhost',
        'user': 'lab',
        'dbname': 'lab',
        'password': 'secret-value',
    })
    assert response.status_code == 200
    data = response.json()
    assert data['tables'] == [{'schema': 'public', 'name': 'orders'}]
    assert data['connection_id']
    assert 'secret-value' not in response.text
    assert connection.execute.call_args_list[0].args[0] == (
        'SET default_transaction_read_only = on'
    )
    assert 'secret-value' not in client.get('/api/experiments').text
    module.sessions.pop(data['connection_id'])


def test_custom_target_requires_explicit_permission():
    """Reject a custom connection ID unless temporary-schema permission is supplied."""
    response = client.post('/api/experiments', json={'connection_id': 'unknown'})
    assert response.status_code == 400


def test_expired_connection_is_rejected():
    """Reject and remove an expired session inserted into the in-memory session map."""
    module.sessions['expired'] = (time.monotonic() - 1, {})
    response = client.post('/api/experiments', json={
        'connection_id': 'expired',
        'allow_test_schema': True,
    })
    assert response.status_code == 409
    assert 'expired' not in module.sessions


def test_missing_lab_returns_actionable_error(monkeypatch):
    """Explain how to configure a database when no default lab host is available.

    Args:
        monkeypatch: Pytest fixture used to remove LAB_DB_HOST from this test's
            environment without changing the caller's environment permanently.
    """
    monkeypatch.delenv('LAB_DB_HOST', raising=False)
    response = client.post('/api/experiments', json={})
    assert response.status_code == 409
    assert 'Docker Compose' in response.json()['detail']


def test_validation_errors_do_not_echo_submitted_passwords():
    """Reject a malformed password value without returning its contents in the 422 response."""
    response = client.post('/api/connections/test', json={
        'host': 'localhost',
        'user': 'lab',
        'dbname': 'lab',
        'password': {'unexpected': 'private-submitted-value'},
    })
    assert response.status_code == 422
    assert 'private-submitted-value' not in response.text
    assert 'input' not in response.json()['detail'][0]


def test_missing_lab_password_is_reported_as_configuration_error(monkeypatch):
    """Use monkeypatch to simulate a host configured without its required password."""
    monkeypatch.setenv('LAB_DB_HOST', 'localhost')
    monkeypatch.delenv('LAB_DB_PASSWORD', raising=False)
    assert not client.get('/api/health').json()['lab_configured']
    assert client.post('/api/experiments', json={}).status_code == 409


def test_invalid_lab_port_returns_actionable_error(monkeypatch):
    """Use monkeypatch to supply an invalid port; reject it before scheduling database work."""
    monkeypatch.setenv('LAB_DB_HOST', 'localhost')
    monkeypatch.setenv('LAB_DB_PASSWORD', 'test-input')
    monkeypatch.setenv('LAB_DB_PORT', 'not-a-port')
    response = client.post('/api/experiments', json={})
    assert response.status_code == 409
    assert 'LAB_DB_PORT' in response.json()['detail']
