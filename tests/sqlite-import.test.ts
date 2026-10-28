import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { importSqlite } from "@/core/sqlite-import";
import { TestMemoryStore } from "./support/postgres";

describe("SQLite import", () => {
  it("keeps IDs and is idempotent", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "spur-import-"));
    const sqlitePath = path.join(directory, "spur.db");
    const sqlite = new Database(sqlitePath);
    sqlite.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, locator TEXT NOT NULL,
        status TEXT NOT NULL, enabled INTEGER NOT NULL, last_synced_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT NOT NULL
      );
      CREATE TABLE memory_objects (
        id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
        title TEXT NOT NULL, statement TEXT NOT NULL, state TEXT NOT NULL,
        authority TEXT NOT NULL, confidence REAL NOT NULL, subjects_json TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL, source_ids_json TEXT NOT NULL, source_version TEXT,
        actor TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT NOT NULL
      );
    `);
    const timestamp = "2026-01-01T00:00:00.000Z";
    sqlite.prepare(
      "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("src_import", "repository", "Imported", "/read-only", "connected", 1, null,
      timestamp, timestamp, "{}");
    sqlite.prepare(
      "INSERT INTO memory_objects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("mem_import", "fingerprint", "rule", "Imported rule", "The ID stays stable.",
      "accepted", "person", 1, "[]", "[]", '["src_import"]', "commit", "Importer",
      timestamp, timestamp, "{}");
    sqlite.close();

    const organization = `import-${randomUUID()}`;
    const databaseUrl = process.env.TEST_DATABASE_URL!;
    try {
      await importSqlite({ sqlitePath, databaseUrl, organization });
      await importSqlite({ sqlitePath, databaseUrl, organization });
      const store = new TestMemoryStore(":memory:", organization);
      try {
        expect(await store.getSource("src_import")).toMatchObject({ id: "src_import", enabled: true });
        expect(await store.getMemory("mem_import")).toMatchObject({
          id: "mem_import",
          source_ids: ["src_import"],
        });
        expect(await store.counts()).toEqual({ memory: 1, sources: 1, candidates: 0 });
      } finally {
        await store.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
