"""Opt-in integration test: LAB_TEST_DSN must point at a disposable database."""
import os
import pytest
import psycopg
from psycopg.conninfo import conninfo_to_dict
from backend.runner import run

@pytest.mark.skipif(not os.getenv('LAB_TEST_DSN'), reason='Disposable PostgreSQL not configured')
def test_real_index_experiment_and_cleanup():
    config=conninfo_to_dict(os.environ['LAB_TEST_DSN'])
    with psycopg.connect(**config) as conn:
        before=set(conn.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'lab_%'").fetchall())
    result=run(config, {'rows':10000,'clients':2,'samples':40,'write_pct':20}, lambda _:None)
    assert result['baseline']['all']['operations']==40
    assert result['candidate']['all']['operations']==40
    assert result['index_bytes']>0
    assert result['baseline']['plan']['Plan']
    with psycopg.connect(**config) as conn:
        after=set(conn.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'lab_%'").fetchall())
    assert before==after


@pytest.mark.skipif(not os.getenv('LAB_TEST_DSN'), reason='Disposable PostgreSQL not configured')
@pytest.mark.parametrize('failure_stage', [
    'Measuring baseline', 'Measuring candidate', 'Cleaning up temporary schema',
])
def test_progress_failure_still_cleans_up_schema(failure_stage):
    """Raise a progress-storage error at each stage and verify the real schema is removed."""
    config = conninfo_to_dict(os.environ['LAB_TEST_DSN'])
    with psycopg.connect(**config) as conn:
        before = set(conn.execute(
            "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'lab_%'"
        ).fetchall())

    def report(stage):
        if stage == failure_stage:
            raise RuntimeError('Simulated progress storage failure')

    with pytest.raises(RuntimeError, match='progress storage failure'):
        run(config, {'rows': 10000, 'clients': 2, 'samples': 20, 'write_pct': 20}, report)

    with psycopg.connect(**config) as conn:
        after = set(conn.execute(
            "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'lab_%'"
        ).fetchall())
    assert after == before
