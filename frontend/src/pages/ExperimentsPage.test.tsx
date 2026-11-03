import type { ComponentProps } from 'react';
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
