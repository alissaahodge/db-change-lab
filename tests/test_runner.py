import pytest
from pydantic import ValidationError
from backend.runner import percentile, summarize
from backend.app import Connection, Experiment

def test_nearest_rank_percentile():
    assert percentile(list(range(1,101)), .95) == 95
    assert percentile([4], .95) == 4

def test_summary_counts_and_units():
    assert summarize([1,2,3,4], 2) == {'operations':4, 'median_ms':2.5,'p95_ms':4, 'throughput':2}

@pytest.mark.parametrize('settings', [{'rows':1},{'clients':0},{'clients':17},{'samples':2001},{'write_pct':101}])
def test_work_is_bounded(settings):
    with pytest.raises(ValidationError): Experiment(**settings)

def test_password_is_redacted():
    c=Connection(host='localhost', dbname='lab', user='lab', password='secret-value')
    assert 'secret-value' not in repr(c)
    assert 'secret-value' not in c.model_dump_json()
