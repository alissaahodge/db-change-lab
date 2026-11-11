import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Experiment, ConnectionResult, ExperimentSettings } from './types';
import { ExperimentsPage, type ExperimentView } from './pages/ExperimentsPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { MethodologyPage } from './pages/MethodologyPage';

export default function App() {
  const [tab, setTab] = useState('Experiments');
  const [settings, setSettings] = useState<ExperimentSettings>({
    rows: 100000,
    clients: 4,
    samples: 200,
    trials: 4,
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
  const [view, setView] = useState<ExperimentView>('New experiment');

  // A mutation invalidates snapshots requested before its history update.
  const historyRevision = useRef(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function refresh() {
      const requestedRevision = historyRevision.current;
      try {
        const [healthResponse, experimentHistory] = await Promise.all([
          api<{ lab_configured: boolean }>('health', undefined, controller.signal),
          api<Experiment[]>('experiments', undefined, controller.signal),
        ]);
        if (active) {
          setHealth(healthResponse.lab_configured);
          if (requestedRevision === historyRevision.current) {
            setRuns(experimentHistory);
          }
          setError((previous) =>
            previous.startsWith('Cannot reach the local backend.') ? '' : previous,
          );
        }
      } catch {
        if (active) {
          setError(
            'Cannot reach the local backend. Start the application and try again.',
          );
        }
      } finally {
        // Schedule after completion so slow requests never overlap.
        if (active) timer = setTimeout(() => void refresh(), 1500);
      }
    }

    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const current = runs.find((experiment) => experiment.id === selected) ?? runs[0];
  const busy =
    sending ||
    runs.some((experiment) =>
      ['queued', 'running', 'cancelling'].includes(experiment.state),
    );

  async function start() {
    historyRevision.current += 1;
    setSending(true);
    setError('');
    try {
      const createdExperiment = await api<{ id: string }>('experiments', {
        ...settings,
        write_pct: settings.custom_workload ? 0 : settings.write_pct,
        connection_id: target === 'custom' ? connection?.connection_id : null,
        allow_test_schema: target === 'custom' && allowSchema,
      });
      setSelected(createdExperiment.id);
      const experimentHistory = await api<Experiment[]>('experiments');
      historyRevision.current += 1;
      setRuns(experimentHistory);
      setView('Results');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function cancelRun(id: string) {
    await api<{ state: 'cancelling' }>(`experiments/${id}/cancel`, {});
    historyRevision.current += 1;
    setRuns((previous) =>
      previous.map((run) =>
        run.id === id && ['queued', 'running'].includes(run.state)
          ? {
              ...run,
              state: 'cancelling',
              stage: 'Waiting for active database work and schema cleanup',
            }
          : run,
      ),
    );
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
              onClick={() => {
                setTab(t);
                if (t === 'Experiments') setView('New experiment');
              }}
              className={tab === t ? 'nav active' : 'nav'}
            >
              <span aria-hidden="true">{['◈', '⇄', '≡'][i]}</span>
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
                  ? view
                  : tab === 'Connections'
                    ? 'Bring your database.'
                    : 'Evidence, with context.'}
              </h1>
              <p className="subtitle">
                {tab === 'Experiments'
                  ? view === 'New experiment'
                    ? 'Choose a workload and measure what an index changes.'
                    : view === 'Results'
                      ? 'Compare the baseline with the indexed run.'
                      : 'Reopen a saved benchmark.'
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
              cancelRun={cancelRun}
              runs={runs}
              setSelected={setSelected}
              view={view}
              setView={setView}
              editRun={(savedSettings) => {
                setSettings(savedSettings);
                setTarget('lab');
                setError('');
                setView('New experiment');
              }}
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
              setTab={(next) => {
                setTab(next);
                setView('New experiment');
              }}
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
