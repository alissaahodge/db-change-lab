"""Exercise the packaged app against generated data on a disposable Compose stack."""
import json
import os
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE = os.getenv('LAB_APP_URL', 'http://127.0.0.1:8000')


def request(path, body=None):
    payload = json.dumps(body).encode() if body is not None else None
    req = Request(BASE + path, data=payload, headers={'Content-Type':'application/json', 'Origin': BASE})
    with urlopen(req, timeout=10) as response:
        return json.load(response)


def experiment(connection_id=None):
    settings = dict(rows=10000, clients=2, samples=40, write_pct=20)
    if not connection_id:
        settings['trials'] = 2
    if connection_id:
        settings.update(
            connection_id=connection_id,
            allow_test_schema=True,
            write_pct=0,
            custom_workload={
                "query": "SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20;",
                "index": "CREATE INDEX ON orders (status, created_at DESC);",
            },
        )
    run_id = request('/api/experiments', settings)['id']
    deadline = time.monotonic()+90
    while time.monotonic() < deadline:
        job = next(r for r in request('/api/experiments') if r['id']==run_id)
        if job['state'] in ('failed','interrupted'):
            raise AssertionError(job['stage'])
        if job['state']=='completed':
            expected_operations = settings['samples'] * settings.get('trials', 1)
            assert job['result']['baseline']['all']['operations'] == expected_operations
            assert job['result']['candidate']['all']['operations'] == expected_operations
            assert len(job['result']['trials']) == settings.get('trials', 1)
            assert job['result']['index_bytes']>0
            return job['result']
        time.sleep(.5)
    raise TimeoutError('Experiment did not finish within 90 seconds')


def main():
    deadline=time.monotonic()+60
    while True:
        try:
            assert request('/api/health')['lab_configured']
            break
        except (URLError, ConnectionError, TimeoutError):
            if time.monotonic()>deadline: raise
            time.sleep(1)
    with urlopen(BASE, timeout=10) as response:
        assert 'DB Change Lab' in response.read().decode()
    result = experiment()
    # Resolve postgres from inside the app container, not this smoke-test process.
    connection = request('/api/connections/test', dict(host='postgres', port=5432, dbname='lab', user='lab', password=os.environ['LAB_DB_PASSWORD'], sslmode='disable'))
    assert connection['version']
    custom = experiment(connection['connection_id'])
    assert custom['baseline']['writes'] is None
    assert custom['candidate']['writes'] is None
    assert custom['index_sql'] == 'CREATE INDEX ON orders (status, created_at DESC);'
    print('Smoke checks passed: packaged UI, background experiment, connection test, custom test target.')
    print('DB_CHANGE_LAB_RESULT=' + json.dumps(result, separators=(',',':')))


if __name__=='__main__':
    main()
