import pytest
from psycopg import sql

from backend.custom import compile_experiment

READ = "SELECT id FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20;"
INDEX = 'CREATE INDEX ON orders (status, created_at DESC);'
TABLE = sql.Identifier('lab_test', 'orders')


def test_compiles_against_generated_table():
    read, index = compile_experiment(READ, INDEX, TABLE)
    assert read.as_string() == (
        """SELECT "id" FROM "lab_test"."orders" WHERE "status" = 'pending' """
        'ORDER BY "created_at" desc LIMIT 20'
    )
    assert index.as_string().endswith('ON "lab_test"."orders" ("status", "created_at" desc)')


@pytest.mark.parametrize('query,index', [
    ('SELECT id FROM public.orders LIMIT 20', INDEX),
    ('SELECT pg_sleep(1) FROM orders LIMIT 20', INDEX),
    ('SELECT id FROM orders LIMIT 20; DELETE FROM orders', INDEX),
    ('SELECT id FROM orders LIMIT 20 FOR UPDATE', INDEX),
    ('SELECT id FROM orders LIMIT 1000', INDEX),
    (READ, 'CREATE INDEX ON public.orders (status)'),
    (READ, 'CREATE INDEX ON orders (lower(status))'),
    (READ, 'CREATE INDEX ON orders (status); DROP TABLE orders'),
])
def test_rejects_sql_outside_the_generated_table_grammar(query, index):
    with pytest.raises(ValueError):
        compile_experiment(query, index, TABLE)
