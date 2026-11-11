import type { Dispatch, SetStateAction } from 'react';
import type { Experiment, ExperimentSettings, ConnectionResult } from '../types';
import { ExperimentForm } from '../components/ExperimentForm';
import { ExperimentResults } from '../components/ExperimentResults';
import { ExperimentHistory } from '../components/ExperimentHistory';

export type ExperimentView = 'New experiment' | 'Results' | 'History';

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
  view: ExperimentView;
  setView: (view: ExperimentView) => void;
  cancelRun: (id: string) => Promise<void>;
  editRun: (settings: ExperimentSettings) => void;
};

export function ExperimentsPage(props: ExperimentsPageProps) {
  return (
    <>
      <nav className="workspace-nav" aria-label="Experiment workspace">
        {(['New experiment', 'Results', 'History'] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-current={props.view === view ? 'page' : undefined}
            onClick={() => props.setView(view)}
          >
            {view}
          </button>
        ))}
      </nav>
      {props.view === 'New experiment' && (
        <div className="experiment-setup">
          <ExperimentForm
            settings={props.settings}
            setSettings={props.setSettings}
            target={props.target}
            setTarget={props.setTarget}
            connection={props.connection}
            allowSchema={props.allowSchema}
            busy={props.busy}
            health={props.health}
            start={props.start}
            error={props.error}
          />
        </div>
      )}
      {props.view === 'Results' && (
        <ExperimentResults
          key={props.current?.id}
          current={props.current}
          editRun={props.editRun}
          cancelRun={props.cancelRun}
        />
      )}
      {props.view === 'History' && (
        <ExperimentHistory
          current={props.current}
          runs={props.runs}
          setSelected={(id) => {
            props.setSelected(id);
            props.setView('Results');
          }}
        />
      )}
    </>
  );
}
