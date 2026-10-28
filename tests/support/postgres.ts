import { randomUUID } from "node:crypto";

import { PostgresMemoryStore } from "@/core/postgres-store";

export class TestMemoryStore extends PostgresMemoryStore {
  constructor(legacyPath = ":memory:", organization = `test-${randomUUID()}`) {
    void legacyPath;
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL was not initialised by the Postgres test setup.");
    super(databaseUrl, organization, organization);
  }
}
