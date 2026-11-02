import type { Dispatch, SetStateAction, FormEvent } from 'react';
import type { ConnectionForm, ConnectionResult } from '../types';

type ConnectionsPageProps = {
  conn: ConnectionForm;
  setConn: Dispatch<SetStateAction<ConnectionForm>>;
  test: (event: FormEvent) => Promise<void>;
  testing: boolean;
  connectionError: string;
  connection: ConnectionResult | null;
  setConnection: Dispatch<SetStateAction<ConnectionResult | null>>;
  allowSchema: boolean;
  setAllowSchema: Dispatch<SetStateAction<boolean>>;
  setTarget: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<string>>;
};

export function ConnectionsPage({
  conn,
  setConn,
  test,
  testing,
  connectionError,
  connection,
  setConnection,
  allowSchema,
  setAllowSchema,
  setTarget,
  setTab,
}: ConnectionsPageProps) {
  return (
    <div className="connection-layout">
      <form className="panel config" onSubmit={(e) => void test(e)}>
        <div className="panel-heading">
          <h2>PostgreSQL connection</h2>
          <span className="pill">Session only</span>
        </div>
        {(['host', 'port', 'dbname', 'user', 'password'] as const).map((key) => (
          <label key={key}>
            {
              {
                host: 'Host',
                port: 'Port',
                dbname: 'Database name',
                user: 'Username',
                password: 'Password',
              }[key]
            }
            <input
              required
              type={key === 'password' ? 'password' : key === 'port' ? 'number' : 'text'}
              autoComplete={key === 'password' ? 'new-password' : 'off'}
              value={conn[key]}
              min={key === 'port' ? 1 : undefined}
              max={key === 'port' ? 65535 : undefined}
              onChange={(e) => {
                setConn({
                  ...conn,
                  [key]: key === 'port' ? +e.target.value : e.target.value,
                });
                setConnection(null);
                setTarget('lab');
                setAllowSchema(false);
              }}
            />
          </label>
        ))}
        <label>
          TLS
          <select
            value={conn.sslmode}
            onChange={(e) => {
              setConn({ ...conn, sslmode: e.target.value });
              setConnection(null);
              setTarget('lab');
              setAllowSchema(false);
            }}
          >
            <option value="require">Require encryption</option>
            <option value="verify-full">Verify certificate and hostname</option>
            <option value="disable">Disabled (local development)</option>
          </select>
        </label>
        <button className="primary" disabled={testing}>
          {testing ? 'Testing connection…' : 'Test connection'} <span>↗</span>
        </button>
        <p className="hint">
          The password field is cleared after testing. Verified credentials stay only in
          backend memory for up to 30 minutes and are never saved to disk. TLS
          verification requires a trusted certificate configured on the backend.
        </p>
        {connectionError && (
          <p role="alert" className="error">
            {connectionError}
          </p>
        )}
      </form>
      <section className="panel schema">
        <h2>{connection ? 'Connection verified' : 'Your schema, at a glance.'}</h2>
        {connection ? (
          <>
            <p role="status" className="success">
              PostgreSQL {connection.version}
            </p>
            <label className="permission">
              <input
                type="checkbox"
                checked={allowSchema}
                onChange={(e) => {
                  setAllowSchema(e.target.checked);
                  if (!e.target.checked) setTarget('lab');
                }}
              />{' '}
              This is a test database. Allow creating and dropping temporary benchmark
              schemas.
            </label>
            <button
              className="primary"
              disabled={!allowSchema}
              onClick={() => {
                setTarget('custom');
                setTab('Experiments');
              }}
            >
              Use for experiments <span>↗</span>
            </button>
            <h3>
              Visible tables <span className="hint">(up to 100)</span>
            </h3>
            {connection.tables.length ? (
              connection.tables.map((t) => (
                <div className="table-row" key={t.schema + '.' + t.name}>
                  <span>▤</span>
                  <code>
                    {t.schema}.{t.name}
                  </code>
                </div>
              ))
            ) : (
              <p>No visible user tables.</p>
            )}
          </>
        ) : (
          <p className="subtitle">
            Enter connection details to verify access and list visible tables.
          </p>
        )}
        <div className="notice">
          <strong>Connecting does not start a benchmark.</strong>
          <p>
            Connection tests only list table names. To benchmark here, explicitly
            designate it as a test database. Experiments create synthetic orders in a
            unique schema, then remove that schema. Existing tables are not used. Schema
            import comes later.
          </p>
        </div>
      </section>
    </div>
  );
}
