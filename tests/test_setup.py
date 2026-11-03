from scripts.setup import initialize


def test_generated_settings_are_private_and_random(tmp_path):
    first, second = tmp_path/'first.env', tmp_path/'second.env'
    assert initialize(first)
    assert initialize(second)
    assert first.read_text().startswith('LAB_DB_PASSWORD=')
    assert first.read_text() != second.read_text()
    assert first.stat().st_mode & 0o777 == 0o600


def test_existing_credentials_are_never_overwritten(tmp_path):
    path = tmp_path/'.env'
    path.write_text('existing configuration\n')
    assert not initialize(path)
    assert path.read_text() == 'existing configuration\n'
