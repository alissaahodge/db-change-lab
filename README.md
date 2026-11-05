# DB Change Lab

**Test an index. See the tradeoffs. Keep the evidence.**

DB Change Lab is an interactive tool for exploring how an index affects a PostgreSQL workload. It runs the same set of operations with and without an index, then shows what changed in query speed, throughput, and storage.

Experiments use generated orders data, so you can try the app without supplying customer records.

![Experiment workspace](docs/experiments.png)

## Start locally

You need Python 3 and Docker with Docker Compose installed.

```bash
python3 scripts/setup.py
docker compose up --build
```

Open [localhost:8000](http://localhost:8000).

The setup script creates a local database password in an ignored `.env` file. Docker starts the app and its PostgreSQL lab database together. Your experiment history is saved between restarts.

## Run your first experiment

1. Choose how many orders to generate, how many clients should run at once, the mix of reads and writes, and how many trials to run.
2. Click **Run experiment**. Each trial measures the workload with and without the index. The order alternates between trials.
3. Compare latency, operations per second, index size, and build time. Use **Variation across trials** to see how consistent the results are. Expand **Execution plans** to see how PostgreSQL ran the lookup.
4. Use **Recent experiments** to revisit a previous result.

Before interpreting a result, read [how measurements work](docs/benchmarking.md). Write operations are rolled back, and run order can affect timings.

## Connect a test database

Open **Connections**, enter your PostgreSQL connection details, and click **Test connection**. This checks access and lists visible tables; it does not start an experiment.

To run experiments there, mark it as a test database and choose **Use for experiments**. The account needs permission to create schemas. The app creates its own temporary schema with generated orders and removes it afterward. It does not benchmark or change your existing application tables.

Verified credentials stay in backend memory for a 30-minute session and are never saved to disk. See the [connection guide](docs/development.md#connecting-to-a-database-from-docker) for Docker hostnames and TLS settings.

![Database connection form](docs/connections.png)
