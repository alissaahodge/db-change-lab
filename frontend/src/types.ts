export type Summary = {
  operations: number;
  median_ms: number;
  p95_ms: number;
  throughput: number;
};
export type Phase = {
  all: Summary;
  reads: Summary | null;
  writes: Summary | null;
  plan: Record<string, unknown>;
};
export type Result = {
  baseline: Phase;
  candidate: Phase;
  index_bytes: number;
  build_ms: number;
  index_sql: string;
  methodology: string;
  settings: { rows: number; clients: number; samples: number; write_pct: number };
};
export type Experiment = {
  id: string;
  created: string;
  state: string;
  stage: string;
  result: Result | null;
};
export type ConnectionResult = {
  connection_id: string;
  version: string;
  tables: { schema: string; name: string }[];
};

export type ExperimentSettings = Result['settings'];
export type ConnectionForm = {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  sslmode: string;
};
