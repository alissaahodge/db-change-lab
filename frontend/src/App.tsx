import React, { useEffect, useState } from 'react';
import { api } from './api';
import type { Experiment, ConnectionResult } from './types';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { MethodologyPage } from './pages/MethodologyPage';

export default function App() {
  const [tab, setTab] = useState('Experiments');
  const [settings, setSettings] = useState({
    rows: 100000,
    clients: 4,
    samples: 200,
    write_pct: 20,
  });
  const [runs, setRuns] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  const [conn, setConn] = useState({
    host: '',
    port: 5432,
    dbname: '',
    user: '',
    password: '',
    sslmode: 'require',
  });
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [testing, setTesting] = useState(false);
  const [target, setTarget] = useState('lab');
  const [allowSchema, setAllowSchema] = useState(false);
  const [plan, setPlan] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [healthResponse, experimentHistory] = await Promise.all([
          api<{ lab_configured: boolean }>('health'),
          api<Experiment[]>('experiments'),
        ]);
        if (active) {
          setHealth(healthResponse.lab_configured);
          setRuns(experimentHistory);
          setError((previous) =>
            previous.startsWith('Cannot reach the local backend.') ? '' : previous,
          );
        }
      } catch {
        if (active)
          setError(
            'Cannot reach the local backend. Start the application and try again.',
          );
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const current = runs.find((experiment) => experiment.id === selected) ?? runs[0];
  const busy =
    sending ||
    runs.some((experiment) => ['queued', 'running'].includes(experiment.state));

  async function start() {
    setSending(true);
    setError('');
    try {
      const createdExperiment = await api<{ id: string }>('experiments', {
        ...settings,
        connection_id: target === 'custom' ? connection?.connection_id : null,
        allow_test_schema: target === 'custom' && allowSchema,
      });
      setSelected(createdExperiment.id);
      setRuns(await api('experiments'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function test(e: React.FormEvent) {
    e.preventDefault();
    setTesting(true);
    setConnection(null);
    setTarget('lab');
    setAllowSchema(false);
    setConnectionError('');
    try {
      setConnection(await api('connections/test', conn));
    } catch (e) {
      setConnectionError((e as Error).message);
    } finally {
      setConn((c) => ({ ...c, password: '' }));
      setTesting(false);
    }
  }

  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/" aria-label="DB Change Lab home">
          <span className="brand-icon">▥</span>
          <span>
            DB Change<span className="brand-lab">Lab</span>
          </span>
        </a>
        <div className="workspace">
          LOCAL WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {['Experiments', 'Connections', 'Methodology'].map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? 'nav active' : 'nav'}
            >
              <span>{['◈', '⇄', '≡'][i]}</span>
              {t}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <span className="dot" /> PostgreSQL experiments
          <br />
          <small>Local-first · v0.1</small>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span> <strong>{tab}</strong>
          </span>
          <span className="local">
            <span className="dot" /> LOCAL ENVIRONMENT
          </span>
        </header>
        <div className="content">
          <div className="eyebrow">MEASURE BEFORE YOU MIGRATE</div>
          <div className="title-row">
            <div>
              <h1>
                {tab === 'Experiments'
                  ? 'A better query starts here.'
                  : tab === 'Connections'
                    ? 'Bring your database.'
                    : 'Evidence, with context.'}
              </h1>
              <p className="subtitle">
                {tab === 'Experiments'
                  ? 'Test an index. See the tradeoffs. Keep the evidence.'
                  : tab === 'Connections'
                    ? 'Verify access and explore your schema. Your credentials stay in this session.'
                    : 'Understand exactly what each experiment measures.'}
              </p>
            </div>
            <span className="version">POSTGRESQL / INDEX LAB</span>
          </div>
          {tab === 'Experiments' && (
            <ExperimentsPage
              settings={settings}
              setSettings={setSettings}
              target={target}
              setTarget={setTarget}
              connection={connection}
              allowSchema={allowSchema}
              busy={busy}
              health={health}
              start={start}
              error={error}
              current={current}
              runs={runs}
              setSelected={setSelected}
              plan={plan}
              setPlan={setPlan}
            />
          )}
          {tab === 'Connections' && (
            <ConnectionsPage
              conn={conn}
              setConn={setConn}
              test={test}
              testing={testing}
              connectionError={connectionError}
              connection={connection}
              setConnection={setConnection}
              allowSchema={allowSchema}
              setAllowSchema={setAllowSchema}
              setTarget={setTarget}
              setTab={setTab}
            />
          )}
          {tab === 'Methodology' && <MethodologyPage />}
          <footer>
            <span>DB CHANGE LAB</span>
            <span>Small changes. Measurable consequences.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
