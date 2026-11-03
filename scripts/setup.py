"""Generate local-only database settings without overwriting existing credentials."""
import os
from pathlib import Path
import secrets


def initialize(path: Path) -> bool:
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(descriptor, 'w') as output:
        output.write('LAB_DB_PASSWORD=' + secrets.token_urlsafe(32) + '\n')
    return True


if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / '.env'
    if os.getenv('LAB_DB_PASSWORD'):
        print('Using LAB_DB_PASSWORD from your environment.')
    elif initialize(path):
        print('Created local database settings in .env. Keep this file private.')
    else:
        print('Existing .env preserved. Ensure it defines LAB_DB_PASSWORD.')
