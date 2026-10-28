import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

import { runMigrations } from "../../src/core/migrations";

export default async function setup() {
  let container: StartedTestContainer | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: "spur_test",
        POSTGRES_PASSWORD: "spur",
        POSTGRES_USER: "spur",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections", 2))
      .start();
    databaseUrl = `postgresql://spur:spur@${container.getHost()}:${container.getMappedPort(5432)}/spur_test`;
  }
  process.env.TEST_DATABASE_URL = databaseUrl;
  await runMigrations(databaseUrl);
  return async () => {
    await container?.stop();
  };
}
