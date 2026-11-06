import type { Dispatch, SetStateAction } from 'react';
import type { Experiment } from '../types';
import { format } from '../format';

type ExperimentResultsProps = {
  current: Experiment | undefined;
  plan: boolean;
  setPlan: Dispatch<SetStateAction<boolean>>;
};

export function ExperimentResults({ current, plan, setPlan }: ExperimentResultsProps) {
  const result = current?.result;
  return (
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
            {format(result.settings.rows)} orders · {result.settings.clients} clients ·{' '}
            {result.settings.samples} operations / phase
            {result.trials && ` · ${result.trials.length} trials`}
          </div>
          {result.settings.custom_workload && (
            <section className="panel comparison">
              <h3>Custom workload</h3>
              <pre>{result.settings.custom_workload.query}</pre>
              <pre>{result.index_sql}</pre>
            </section>
          )}
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
              const maxMedian = Math.max(baseline.median_ms, candidate.median_ms, 0.001);
              return (
                <div className="bar-group" key={kind}>
                  <strong>
                    {kind === 'reads'
                      ? result.settings.custom_workload
                        ? 'Custom read query'
                        : 'Customer order lookup'
                      : 'Insert order (rolled back)'}
                  </strong>
                  <div className="bar-row">
                    <div
                      className="bar baseline"
                      style={{
                        width: Math.max(1, (baseline.median_ms / maxMedian) * 75) + '%',
                      }}
                    />
                    <span>{format(baseline.median_ms)} ms</span>
                  </div>
                  <div className="bar-row">
                    <div
                      className="bar candidate"
                      style={{
                        width: Math.max(1, (candidate.median_ms / maxMedian) * 75) + '%',
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
          {result.trials && result.trials.length > 1 && (
            <section className="panel comparison">
              <h3>Variation across trials</h3>
              <p className="hint">
                Each cell compares baseline → with index. The cards above pool
                measurements across all trials.
              </p>
              <div className="trial-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Trial</th>
                      <th scope="col">First phase</th>
                      <th scope="col">Median (ms)</th>
                      <th scope="col">p95 (ms)</th>
                      <th scope="col">Throughput (ops/s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trials.map(({ order, baseline, candidate }, index) => (
                      <tr key={index}>
                        <th scope="row">{index + 1}</th>
                        <td>{order[0] === 'baseline' ? 'Baseline' : 'With index'}</td>
                        <td>
                          {format(baseline.median_ms)} → {format(candidate.median_ms)}
                        </td>
                        <td>
                          {format(baseline.p95_ms)} → {format(candidate.p95_ms)}
                        </td>
                        <td>
                          {format(baseline.throughput)} → {format(candidate.throughput)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
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
  );
}
