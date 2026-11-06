"""Compile a restricted SQL grammar for the generated orders table."""
import re

from psycopg import sql

COLUMN = r'(?:id|customer_id|status|total_cents|created_at)'
KEY = rf'{COLUMN}(?:\s+(?:ASC|DESC))?'
FLAGS = re.IGNORECASE | re.ASCII
SELECT = re.compile(
    rf'SELECT\s+(\*|{COLUMN}(?:\s*,\s*{COLUMN})*)\s+FROM\s+orders'
    rf"(?:\s+WHERE\s+(id|customer_id|status|total_cents)\s*=\s*([0-9]{{1,9}}|'pending'|'completed'))?"
    rf'(?:\s+ORDER\s+BY\s+({KEY}))?\s+LIMIT\s+([1-9][0-9]{{0,2}})\s*;?',
    FLAGS,
)
INDEX = re.compile(
    rf'CREATE\s+INDEX\s+ON\s+orders\s*\(\s*({KEY}(?:\s*,\s*{KEY}){{0,4}})\s*\)\s*;?',
    FLAGS,
)
INDEX_NAME = 'orders_customer_created_idx'


def sort_key(key):
    column, *direction = key.lower().split()
    suffix = sql.SQL(' ' + direction[0]) if direction else sql.SQL('')
    return sql.Identifier(column) + suffix


def compile_experiment(query, index, table):
    select = SELECT.fullmatch(query.strip())
    if not select:
        raise ValueError(
            'Use SELECT columns FROM orders, optional WHERE column = value and ORDER BY, '
            'and a LIMIT from 1 to 999.'
        )
    definition = INDEX.fullmatch(index.strip())
    if not definition:
        raise ValueError('Use CREATE INDEX ON orders with one to five columns and optional ASC or DESC.')

    columns, column, value, ordering, limit = select.groups()
    projection = sql.SQL('*') if columns == '*' else sql.SQL(', ').join(
        sql.Identifier(name.strip().lower()) for name in columns.split(',')
    )
    read = sql.SQL('SELECT {} FROM {}').format(projection, table)
    if column:
        column = column.lower()
        if column == 'status' and value.startswith("'"):
            literal = value[1:-1]
            if literal not in ('pending', 'completed'):
                raise ValueError("Status values are case sensitive: use 'pending' or 'completed'.")
        elif column != 'status' and value.isdigit():
            literal = int(value)
        else:
            raise ValueError("Filter status with 'pending' or 'completed', and numeric columns with an integer.")
        read += sql.SQL(' WHERE {} = {}').format(sql.Identifier(column), sql.Literal(literal))
    if ordering:
        read += sql.SQL(' ORDER BY {}').format(sort_key(ordering))
    read += sql.SQL(' LIMIT {}').format(sql.Literal(int(limit)))
    keys = sql.SQL(', ').join(sort_key(key) for key in definition[1].split(','))
    create_index = sql.SQL('CREATE INDEX {} ON {} ({})').format(sql.Identifier(INDEX_NAME), table, keys)
    return read, create_index
