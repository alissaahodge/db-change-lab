import type { Dispatch, SetStateAction } from 'react';
import type { Experiment, ExperimentSettings, ConnectionResult } from '../types';
import { ExperimentForm } from '../components/ExperimentForm';
import { ExperimentResults } from '../components/ExperimentResults';
import { ExperimentHistory } from '../components/ExperimentHistory';

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
  plan: boolean;
  setPlan: Dispatch<SetStateAction<boolean>>;
};

export function ExperimentsPage(props: ExperimentsPageProps) {
  return (
    <>
      <div className="layout">
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
        <ExperimentResults
          current={props.current}
          plan={props.plan}
          setPlan={props.setPlan}
        />
      </div>
      <ExperimentHistory
        current={props.current}
        runs={props.runs}
        setSelected={props.setSelected}
      />
    </>
  );
}
