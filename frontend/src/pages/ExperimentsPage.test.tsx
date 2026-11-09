import { useState, type ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import type { Experiment } from '../types';
import { cleanup, render, screen, within } from '@testing-library/react';
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
        plan: {
          Plan: {
            'Node Type': 'Limit',
            'Actual Rows': 20,
            'Shared Hit Blocks': 50,
            'Shared Read Blocks': 1,
            Plans: [
              {
                'Node Type': 'Sort',
                Plans: [{ 'Node Type': 'Seq Scan', 'Shared Hit Blocks': 50 }],
              },
            ],
          },
        },
      },
      candidate: {
        all: summary,
        reads: summary,
        writes: null,
        plan: {
          Plan: {
            'Node Type': 'Limit',
            'Actual Rows': 20,
            'Shared Hit Blocks': 3,
            'Shared Read Blocks': 0,
            Plans: [{ 'Node Type': 'Index Scan', 'Index Name': 'orders_idx' }],
          },
        },
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
  const comparison = within(
    screen.getByRole('table', { name: 'Execution plan comparison' }),
  );
  expect(
    comparison.getByRole('row', { name: /Scan steps Seq Scan Index Scan/ }),
  ).toBeTruthy();
  expect(comparison.getByRole('row', { name: /Sort steps Sort None/ })).toBeTruthy();
  expect(comparison.getByRole('row', { name: /Shared blocks hit 50 3/ })).toBeTruthy();
  expect(comparison.getByRole('row', { name: /Shared blocks read 1 0/ })).toBeTruthy();
  await user.click(screen.getByText('Raw JSON plans'));
  expect(screen.getByText(/"Node Type": "Seq Scan"/).closest('details')?.open).toBe(true);
  await user.click(disclosure);
  expect(screen.queryByRole('table', { name: 'Execution plan comparison' })).toBeNull();
});
