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
      <label>
        Dataset
        <select>
          <option>Commerce / Orders</option>
        </select>
      </label>
      <p className="hint">Deterministic synthetic data. No customer records required.</p>
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
        <span className="pill">B-tree</span> <span className="hint">Composite index</span>
      </div>
      <PrimaryButton
        onClick={() => void start()}
        disabled={
          busy || (target === 'lab' ? health !== true : !connection || !allowSchema)
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
