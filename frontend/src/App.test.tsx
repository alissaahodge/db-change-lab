import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { api } from './api';
import type { ConnectionResult, Experiment } from './types';

vi.mock('./api', () => ({ api: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function mockApi(handler: (path: string, body?: unknown) => Promise<unknown>) {
  vi.mocked(api).mockImplementation(handler as typeof api);
}

beforeEach(() => vi.mocked(api).mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('experiment history polling', () => {
  it('waits for a slow snapshot before scheduling another poll', async () => {
    vi.useFakeTimers();
    const history = deferred<Experiment[]>();
    let historyRequests = 0;
    mockApi(async (path) => {
      if (path === 'health') return { lab_configured: true };
      historyRequests += 1;
      return history.promise;
    });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(historyRequests).toBe(1);

    await act(async () => history.resolve([]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(historyRequests).toBe(2);
  });

  it('keeps a newly created run when an older poll finishes later', async () => {
    vi.useFakeTimers();
    const oldHistory = deferred<Experiment[]>();
    const createdRun: Experiment = {
      id: 'newrun123456',
      created: '2026-11-03 12:00:00',
      state: 'queued',
      stage: 'Waiting for runner',
      result: null,
    };
    let historyRequests = 0;
    mockApi(async (path, body) => {
      if (path === 'health') return { lab_configured: true };
      if (body) return { id: createdRun.id };
      historyRequests += 1;
      if (historyRequests === 1) return [];
      if (historyRequests === 2) return oldHistory.promise;
      return [createdRun];
    });

    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Run experiment/ }));
    });
    expect(screen.getByText('Waiting for runner')).toBeTruthy();

    await act(async () => oldHistory.resolve([]));
    expect(screen.getByText('Waiting for runner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New experiment' }));
    expect(
      (
        screen.getByRole('button', {
          name: /Experiment in progress/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

it('locks connection fields until testing finishes, then clears the password', async () => {
  const user = userEvent.setup();
  const verification = deferred<ConnectionResult>();
  mockApi(async (path) => {
    if (path === 'health') return { lab_configured: true };
    if (path === 'connections/test') return verification.promise;
    return [];
  });
  render(<App />);
  await user.click(screen.getByRole('button', { name: /Connections/ }));
  const host = screen.getByLabelText('Host') as HTMLInputElement;
  await user.type(host, 'localhost');
  await user.type(screen.getByLabelText('Database name'), 'lab');
  await user.type(screen.getByLabelText('Username'), 'lab');
  await user.type(screen.getByLabelText('Password'), 'test-input');
  await user.click(screen.getByRole('button', { name: /Test connection/ }));

  expect(host.disabled).toBe(true);
  expect((screen.getByLabelText('TLS') as HTMLSelectElement).disabled).toBe(true);
  await user.type(host, '.changed');
  expect(host.value).toBe('localhost');

  await act(async () => {
    verification.resolve({ connection_id: 'verified', version: '17', tables: [] });
  });
  await waitFor(() => expect(host.disabled).toBe(false));
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  expect(screen.getByText('Connection verified')).toBeTruthy();
});

it('submits the edited custom workload with writes disabled', async () => {
  const user = userEvent.setup();
  mockApi(async (path, body) => {
    if (path === 'health') return { lab_configured: true };
    return body ? { id: 'custom-run' } : [];
  });

  render(<App />);
  await user.selectOptions(screen.getByLabelText('Workload', { exact: true }), 'custom');
  const query = 'SELECT id FROM orders WHERE customer_id = 1 LIMIT 10';
  await user.clear(screen.getByLabelText('Read query'));
  await user.type(screen.getByLabelText('Read query'), query);
  await user.click(screen.getByRole('button', { name: 'Run experiment' }));

  expect(api).toHaveBeenCalledWith(
    'experiments',
    expect.objectContaining({
      write_pct: 0,
      custom_workload: {
        query,
        index: 'CREATE INDEX ON orders (status, created_at DESC);',
      },
    }),
  );
});
