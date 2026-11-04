import type { Dispatch, SetStateAction } from 'react';
import type { Experiment } from '../types';

type ExperimentHistoryProps = {
  current: Experiment | undefined;
  runs: Experiment[];
  setSelected: Dispatch<SetStateAction<string | null>>;
};

export function ExperimentHistory({
  current,
  runs,
  setSelected,
}: ExperimentHistoryProps) {
  return (
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
  );
}
