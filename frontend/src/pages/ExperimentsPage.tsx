import type { Dispatch, SetStateAction } from 'react';
import type { Experiment, ExperimentSettings, ConnectionResult } from '../types';
import { format } from '../format';

type ExperimentsPageProps = {
  settings: ExperimentSettings;
  setSettings: Dispatch<SetStateAction<ExperimentSettings>>;
  target: string;
  setTarget: Dispatch<SetStateAction<string>>;
  connection: ConnectionResult | null;
  allowSchema: boolean;
  busy: boolean;
  health: boolean | null;
  start: () => Promise<void>;
  error: string;
  current: Experiment | undefined;
  runs: Experiment[];
  setSelected: Dispatch<SetStateAction<string | null>>;
  plan: boolean;
  setPlan: Dispatch<SetStateAction<boolean>>;
};

export function ExperimentsPage({
  settings,
  setSettings,
  target,
  setTarget,
  connection,
  allowSchema,
  busy,
  health,
  start,
  error,
  current,
  runs,
  setSelected,
  plan,
  setPlan,
}: ExperimentsPageProps) {
  const result = current?.result;

  return (
    <>
      <div className="layout">
        <section className="panel config">
          <div className="panel-heading">
            <h2>Configure experiment</h2>
            <span className="step">01</span>
          </div>
          <label>
            Test database
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="lab">Dedicated lab database</option>
              {connection && allowSchema && (
                <option value="custom">My verified test database</option>
              )}
            </select>
          </label>
          <label>
            Dataset
            <select>
              <option>Commerce / Orders</option>
            </select>
          </label>
          <p className="hint">
            Deterministic synthetic data. No customer records required.
          </p>
          <div className="two">
            <label>
              Order count
              <select
                value={settings.rows}
                onChange={(e) => setSettings({ ...settings, rows: +e.target.value })}
              >
                {[10000, 100000, 500000, 1000000].map((rowCount) => (
                  <option key={rowCount} value={rowCount}>
                    {format(rowCount)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Concurrent clients
              <input
                type="number"
                min="1"
                max="16"
                value={settings.clients}
                onChange={(e) => setSettings({ ...settings, clients: +e.target.value })}
              />
            </label>
          </div>
          <label>
            Operations per phase
            <input
              type="number"
              min="20"
              max="2000"
              value={settings.samples}
              onChange={(e) => setSettings({ ...settings, samples: +e.target.value })}
            />
          </label>
          <label className="range-label">
            Workload mix{' '}
            <strong>
              {100 - settings.write_pct}% reads / {settings.write_pct}% writes
            </strong>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.write_pct}
              onChange={(e) => setSettings({ ...settings, write_pct: +e.target.value })}
            />
          </label>
          <div className="mix">
            <span style={{ width: 100 - settings.write_pct + '%' }} />
          </div>
          <div className="change">
            <span className="eyebrow">PROPOSED CHANGE</span>
            <pre>CREATE INDEX ON orders{'\n'} (customer_id, created_at DESC);</pre>
            <span className="pill">B-tree</span>{' '}
            <span className="hint">Composite index</span>
          </div>
          <button
            className="primary"
            onClick={() => void start()}
            disabled={
              busy || (target === 'lab' ? health !== true : !connection || !allowSchema)
            }
          >
            {busy ? 'Experiment in progress…' : 'Run experiment'} <span>↗</span>
          </button>
          <p className="hint footnote">
            {target === 'custom'
              ? 'Creates and drops a temporary schema on your test database.'
              : health === false
                ? 'Lab not configured. Start Docker Compose or add a test connection.'
                : 'Runs in a temporary schema on the dedicated lab database.'}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
        <section className="results">
          <div className="results-header">
            <h2>Experiment results</h2>
            {current && <span className="pill">{current.state}</span>}
          </div>
          {!result ? (
            <div className="empty panel">
              <div className="orbit">↗</div>
              <h3>{current ? current.stage : 'Your hypothesis. Real measurements.'}</h3>
              <p>
                {current && ['queued', 'running'].includes(current.state)
                  ? 'The runner is working. Results will appear here automatically.'
                  : 'Run your first experiment to compare query latency, execution plans, and index storage.'}
              </p>
              <div className="empty-steps">
                <span>01 / Baseline</span>
                <span>02 / Index</span>
                <span>03 / Compare</span>
              </div>
            </div>
          ) : (
            <>
              <div className="result-caption">
                {format(result.settings.rows)} orders · {result.settings.clients} clients
                · {result.settings.samples} operations / phase
              </div>
              <div className="metrics">
                {[
                  [
                    'Median latency',
                    result.baseline.all.median_ms,
                    result.candidate.all.median_ms,
                    'ms',
                  ],
                  [
                    'p95 latency',
                    result.baseline.all.p95_ms,
                    result.candidate.all.p95_ms,
                    'ms',
                  ],
                  [
                    'Throughput',
                    result.baseline.all.throughput,
                    result.candidate.all.throughput,
                    'ops/s',
                  ],
                ].map(([label, baselineValue, candidateValue, unit]) => (
                  <article className="panel metric" key={label}>
                    <span>{label}</span>
                    <h3>
                      {format(Number(candidateValue))}
                      <small>{unit}</small>
                    </h3>
                    <div>
                      Baseline <strong>{format(Number(baselineValue))}</strong>
                    </div>
                  </article>
                ))}
              </div>
              <section className="panel comparison">
                <h3>Latency by operation</h3>
                <p className="hint">Client-side statement latency · lower is better</p>
                <div className="legend">
                  <span>■ Baseline</span>
                  <span>■ With index</span>
                </div>
                {(['reads', 'writes'] as const).map((kind) => {
                  const baseline = result.baseline[kind],
                    candidate = result.candidate[kind];
                  if (!baseline || !candidate) return null;
                  const maxMedian = Math.max(
                    baseline.median_ms,
                    candidate.median_ms,
                    0.001,
                  );
                  return (
                    <div className="bar-group" key={kind}>
                      <strong>
                        {kind === 'reads'
                          ? 'Customer order lookup'
                          : 'Insert order (rolled back)'}
                      </strong>
                      <div className="bar-row">
                        <div
                          className="bar baseline"
                          style={{
                            width:
                              Math.max(1, (baseline.median_ms / maxMedian) * 75) + '%',
                          }}
                        />
                        <span>{format(baseline.median_ms)} ms</span>
                      </div>
                      <div className="bar-row">
                        <div
                          className="bar candidate"
                          style={{
                            width:
                              Math.max(1, (candidate.median_ms / maxMedian) * 75) + '%',
                          }}
                        />
                        <span>{format(candidate.median_ms)} ms</span>
                      </div>
                    </div>
                  );
                })}
              </section>
              <div className="storage panel">
                <span>
                  Index footprint{' '}
                  <strong>{format(result.index_bytes / 1024 / 1024)} MB</strong>
                </span>
                <span>
                  Build time <strong>{format(result.build_ms)} ms</strong>
                </span>
              </div>
              <section className="panel plans">
                <button
                  className="disclosure"
                  aria-expanded={plan}
                  onClick={() => setPlan(!plan)}
                >
                  Execution plans <span>{plan ? '−' : '+'}</span>
                </button>
                {plan && (
                  <div className="two">
                    <div>
                      <h4>Baseline</h4>
                      <pre>{JSON.stringify(result.baseline.plan, null, 2)}</pre>
                    </div>
                    <div>
                      <h4>With index</h4>
                      <pre>{JSON.stringify(result.candidate.plan, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </section>
              <p className="hint">{result.methodology}</p>
            </>
          )}
        </section>
      </div>
      <section className="history panel">
        <div className="panel-heading">
          <h2>Recent experiments</h2>
          <span className="hint">Saved locally · last 50</span>
        </div>
        {runs.length === 0 ? (
          <p className="hint">No experiments yet. Your first run will start the story.</p>
        ) : (
          <div className="history-list">
            {runs.map((experiment) => (
              <button
                className={
                  experiment.id === current?.id ? 'history-row chosen' : 'history-row'
                }
                key={experiment.id}
                onClick={() => setSelected(experiment.id)}
              >
                <code>{experiment.id.slice(0, 8)}</code>
                <span>{experiment.created} UTC</span>
                <span>{experiment.stage}</span>
                <span className="pill">{experiment.state}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
