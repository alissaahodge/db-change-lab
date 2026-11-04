import { useState, type ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import type { Experiment } from '../types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExperimentsPage } from './ExperimentsPage';

afterEach(cleanup);

it('shows the proposed index as readable SQL on two lines', () => {
  const props: ComponentProps<typeof ExperimentsPage> = {
    settings: { rows: 10000, clients: 2, samples: 40, write_pct: 20 },
    setSettings: vi.fn(),
    target: 'lab',
    setTarget: vi.fn(),
    connection: null,
    allowSchema: false,
    busy: false,
    health: true,
    start: vi.fn(async () => {}),
    error: '',
    current: undefined,
    runs: [],
    setSelected: vi.fn(),
    plan: false,
    setPlan: vi.fn(),
  };
  render(<ExperimentsPage {...props} />);
  expect(screen.getByText(/CREATE INDEX/).textContent).toBe(
    'CREATE INDEX ON orders\n (customer_id, created_at DESC);',
  );
});

it('keeps run, history selection, and plan disclosure wired through the page', async () => {
  const user = userEvent.setup();
  const start = vi.fn(async () => {});
  const summary = { operations: 40, median_ms: 2, p95_ms: 3, throughput: 100 };
  const run: Experiment = {
    id: 'completed123',
    created: '2026-11-04',
    state: 'completed',
    stage: 'Done',
    result: {
      baseline: {
        all: summary,
        reads: summary,
        writes: null,
        plan: { Node: 'Seq Scan' },
      },
      candidate: {
        all: summary,
        reads: summary,
        writes: null,
        plan: { Node: 'Index Scan' },
      },
      index_bytes: 1024,
      build_ms: 10,
      index_sql: 'CREATE INDEX',
      methodology: 'Statement latency',
      settings: { rows: 10000, clients: 2, samples: 40, write_pct: 0 },
    },
  };
  function Workbench() {
    const [selected, setSelected] = useState<string | null>(null);
    const [plan, setPlan] = useState(false);
    const [settings, setSettings] = useState(run.result!.settings);
    const [target, setTarget] = useState('lab');
    return (
      <ExperimentsPage
        settings={settings}
        setSettings={setSettings}
        target={target}
        setTarget={setTarget}
        connection={null}
        allowSchema={false}
        busy={false}
        health={true}
        start={start}
        error="Example error"
        current={selected === run.id ? run : undefined}
        runs={[run]}
        setSelected={setSelected}
        plan={plan}
        setPlan={setPlan}
      />
    );
  }
  render(<Workbench />);
  expect(screen.getByRole('alert').textContent).toBe('Example error');
  await user.selectOptions(screen.getByLabelText('Order count'), '100000');
  expect((screen.getByLabelText('Order count') as HTMLSelectElement).value).toBe(
    '100000',
  );
  await user.click(screen.getByRole('button', { name: 'Run experiment' }));
  expect(start).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: /complete/ }));
  const disclosure = screen.getByRole('button', { name: /Execution plans/ });
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  await user.click(disclosure);
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText(/Seq Scan/)).toBeTruthy();
  expect(screen.getByText(/Index Scan/)).toBeTruthy();
  await user.click(disclosure);
  expect(screen.queryByText(/Seq Scan/)).toBeNull();
});
