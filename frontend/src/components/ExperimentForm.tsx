import type { Dispatch, SetStateAction } from 'react';
import type { ExperimentSettings, ConnectionResult } from '../types';
import { format } from '../format';
import { PrimaryButton } from './PrimaryButton';
import { ErrorMessage } from './ErrorMessage';

type ExperimentFormProps = {
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
};

export function ExperimentForm({
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
}: ExperimentFormProps) {
  return (
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
      <p className="hint">Experiments use generated orders.</p>
      <label>
        Workload
        <select
          value={settings.custom_workload ? 'custom' : 'preset'}
          onChange={(e) =>
            setSettings({
              ...settings,
              custom_workload:
                e.target.value === 'custom'
                  ? {
                      query:
                        "SELECT id, created_at FROM orders\nWHERE status = 'pending' ORDER BY created_at DESC LIMIT 20;",
                      index: 'CREATE INDEX ON orders (status, created_at DESC);',
                    }
                  : null,
            })
          }
        >
          <option value="preset">Preset order workload</option>
          <option value="custom">Custom read query and index</option>
        </select>
      </label>
      {settings.custom_workload ? (
        <div className="change">
          <p className="hint">
            Uses generated orders only. Select columns from orders, optionally filter one
            column by equality and sort by one column, and include LIMIT 1–999. Columns:
            id, customer_id, status, total_cents, created_at.
          </p>
          <label>
            Read query
            <textarea
              rows={4}
              maxLength={512}
              value={settings.custom_workload.query}
              onChange={(e) => {
                const query = e.target.value;
                setSettings((previous) =>
                  previous.custom_workload
                    ? {
                        ...previous,
                        custom_workload: { ...previous.custom_workload, query },
                      }
                    : previous,
                );
              }}
            />
          </label>
          <label>
            Proposed index
            <textarea
              rows={3}
              maxLength={256}
              value={settings.custom_workload.index}
              onChange={(e) => {
                const index = e.target.value;
                setSettings((previous) =>
                  previous.custom_workload
                    ? {
                        ...previous,
                        custom_workload: { ...previous.custom_workload, index },
                      }
                    : previous,
                );
              }}
            />
          </label>
          <p className="hint">Use CREATE INDEX ON orders with one to five columns.</p>
        </div>
      ) : (
        <>
          <div className="change">
            <span className="eyebrow">PROPOSED CHANGE</span>
            <pre>CREATE INDEX ON orders{'\n'} (customer_id, created_at DESC);</pre>
            <span className="pill">B-tree</span>{' '}
            <span className="hint">Composite index</span>
          </div>
        </>
      )}
      <p className="hint">
        {format(settings.rows)} orders · {settings.clients} clients · {settings.samples}{' '}
        operations per phase per trial · {settings.trials ?? 1}{' '}
        {(settings.trials ?? 1) === 1 ? 'trial' : 'trials'} ·{' '}
        {settings.custom_workload ? 'reads only' : `${settings.write_pct}% writes`}
      </p>
      <details className="run-settings">
        <summary>Run settings</summary>
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
          Operations per phase per trial
          <input
            type="number"
            min="20"
            max="2000"
            value={settings.samples}
            onChange={(e) => setSettings({ ...settings, samples: +e.target.value })}
          />
        </label>
        <label>
          Trials
          <select
            value={settings.trials ?? 1}
            onChange={(e) => setSettings({ ...settings, trials: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Each trial runs both phases. More trials take longer and show how much results
          vary.
        </p>
        {!settings.custom_workload && (
          <>
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
          </>
        )}
      </details>
      <PrimaryButton
        onClick={() => void start()}
        disabled={
          busy ||
          (settings.custom_workload != null &&
            (!settings.custom_workload.query.trim() ||
              !settings.custom_workload.index.trim())) ||
          (target === 'lab' ? health !== true : !connection || !allowSchema)
        }
      >
        {busy ? 'Experiment in progress…' : 'Run experiment'}
      </PrimaryButton>
      <p className="hint footnote">
        {target === 'custom'
          ? 'Creates and drops a temporary schema on your test database.'
          : health === false
            ? 'Lab not configured. Start Docker Compose or add a test connection.'
            : 'Runs in a temporary schema on the dedicated lab database.'}
      </p>
      <ErrorMessage message={error} />
    </section>
  );
}
