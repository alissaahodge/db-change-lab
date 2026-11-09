import { format } from '../format';
import type { Phase } from '../types';

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function summarize(plan: Phase['plan']) {
  const root = record(plan.Plan);
  if (!root || typeof root['Node Type'] !== 'string') return;

  const scans: string[] = [];
  const sorts: string[] = [];

  function visit(node: Record<string, unknown>) {
    const type = node['Node Type'];
    if (typeof type === 'string') {
      if (type.endsWith('Scan')) {
        const target = [node['Relation Name'], node['Index Name']]
          .filter((name) => typeof name === 'string')
          .join(' / ');
        scans.push(target ? `${type} (${target})` : type);
      }
      if (type === 'Sort' || type === 'Incremental Sort') {
        const keys = node['Sort Key'];
        sorts.push(
          Array.isArray(keys) && keys.length ? `${type} (${keys.join(', ')})` : type,
        );
      }
    }
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        const entry = record(child);
        if (entry) visit(entry);
      }
    }
  }

  visit(root);
  return { root, scans, sorts };
}

function metric(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? format(value) : '—';
}

export function PlanComparison({
  baseline,
  candidate,
}: {
  baseline: Phase['plan'];
  candidate: Phase['plan'];
}) {
  const before = summarize(baseline);
  const after = summarize(candidate);
  const describeSteps = (steps: string[]) => steps.join(' · ') || 'None';
  const rows = before &&
    after && [
      ['Scan steps', describeSteps(before.scans), describeSteps(after.scans)],
      ['Sort steps', describeSteps(before.sorts), describeSteps(after.sorts)],
      [
        'Output rows',
        metric(before.root['Actual Rows']),
        metric(after.root['Actual Rows']),
      ],
      [
        'Shared blocks hit',
        metric(before.root['Shared Hit Blocks']),
        metric(after.root['Shared Hit Blocks']),
      ],
      [
        'Shared blocks read',
        metric(before.root['Shared Read Blocks']),
        metric(after.root['Shared Read Blocks']),
      ],
    ];

  return (
    <>
      {rows ? (
        <>
          <p className="hint">
            Plans are sampled separately from the timed workload in the final trial. Rows
            and shared buffers are reported at the root of each plan.
          </p>
          <table className="plan-comparison" aria-label="Execution plan comparison">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Baseline</th>
                <th scope="col">With index</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, left, right]) => {
                const changed = left !== right && left !== '—' && right !== '—';
                return (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{left}</td>
                    <td className={changed ? 'plan-changed' : undefined}>
                      {right}
                      {changed && <span className="plan-change-label">Changed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="hint">A structured comparison is unavailable for these plans.</p>
      )}
      <details className="raw-plans">
        <summary>Raw JSON plans</summary>
        <div className="two">
          <div>
            <h4>Baseline</h4>
            <pre>{JSON.stringify(baseline, null, 2)}</pre>
          </div>
          <div>
            <h4>With index</h4>
            <pre>{JSON.stringify(candidate, null, 2)}</pre>
          </div>
        </div>
      </details>
    </>
  );
}
