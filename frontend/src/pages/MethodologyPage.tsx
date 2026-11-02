export function MethodologyPage() {
  return (
    <section className="panel methodology">
      <h2>What the numbers mean</h2>
      <h3>Same workload, two phases</h3>
      <p>
        Each run creates a unique temporary schema and deterministic orders dataset. A
        fixed random seed produces the same customer lookups and read/write sequence for
        baseline and candidate. Only the candidate has the composite index.
      </p>
      <h3>Warmup and timing</h3>
      <p>
        Every client warms the read query before sampling. Latency measures the statement
        round trip and fetching its results. Throughput covers the complete phase,
        including client connection setup and transaction rollback. p95 uses the
        nearest-rank method.
      </p>
      <h3>Writes are rolled back</h3>
      <p>
        Insert measurements capture statement execution and index maintenance, but exclude
        commit and durable WAL flush. They do not predict production write throughput.
      </p>
      <h3>Order matters</h3>
      <p>
        The baseline runs first, so cache and order effects can influence the candidate.
        Repeat runs and inspect raw plans. The current version is an exploratory
        benchmark, not a production migration approval system.
      </p>
      <h3>Isolation and credentials</h3>
      <p>
        Experiments only create generated data in a unique schema on the dedicated lab or
        a user-designated test database, then drop it on completion or failure. A hard
        process termination can leave a schema behind. Connection tests use a read-only
        session; credentials are never stored in experiment history.
      </p>
    </section>
  );
}
