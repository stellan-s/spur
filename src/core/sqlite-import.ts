import path from "node:path";

import Database from "better-sqlite3";
import { Pool, type PoolClient } from "pg";

const TABLES = [
  "sources",
  "memory_objects",
  "memory_aliases",
  "evidence",
  "relationships",
  "memory_merges",
  "knowledge_gaps",
  "investigations",
  "conversations",
  "conversation_turns",
  "source_analysis_runs",
  "source_analysis_run_objects",
  "source_analysis_run_relationships",
  "isms_controls",
  "isms_control_revisions",
] as const;

const JSON_COLUMNS = new Set([
  "metadata_json",
  "subjects_json",
  "evidence_ids_json",
  "source_ids_json",
  "analysis_json",
  "recalled_memory_ids_json",
  "learned_memory_ids_json",
  "payload_json",
]);

type ImportTable = (typeof TABLES)[number];
type SqliteRow = Record<string, string | number | null>;

export type SqliteImportResult = {
  path: string;
  organization: string;
  rows: Record<ImportTable, number>;
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function normaliseValue(column: string, value: SqliteRow[string]): unknown {
  if (column === "enabled") return Boolean(value);
  if (column === "reference_key" && typeof value === "string") return value.replaceAll("\u0000", "\u001f");
  if (JSON_COLUMNS.has(column)) return value ?? (column.endsWith("_ids_json") ? "[]" : "{}");
  return value;
}

async function importTable(
  sqlite: Database.Database,
  postgres: PoolClient,
  organization: string,
  table: ImportTable,
): Promise<number> {
  if (!tableExists(sqlite, table)) return 0;
  const rows = sqlite.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as SqliteRow[];
  for (const row of rows) {
    const columns = Object.keys(row);
    const targetColumns = ["organization_id", ...columns];
    const values = [organization, ...columns.map((column) => normaliseValue(column, row[column]))];
    const placeholders = values.map((_, index) => {
      const column = targetColumns[index];
      return `$${index + 1}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`;
    });
    await postgres.query(
      `INSERT INTO ${quoteIdentifier(table)} (${targetColumns.map(quoteIdentifier).join(", ")})
       VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return rows.length;
}

export async function importSqlite(input: {
  sqlitePath: string;
  databaseUrl: string;
  organization: string;
  organizationName?: string;
}): Promise<SqliteImportResult> {
  const sqlitePath = path.resolve(input.sqlitePath);
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({ connectionString: input.databaseUrl, max: 1 });
  const postgres = await pool.connect();
  const counts = Object.fromEntries(TABLES.map((table) => [table, 0])) as Record<ImportTable, number>;
  try {
    await postgres.query("BEGIN");
    await postgres.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
      [input.organization, input.organizationName ?? input.organization, new Date().toISOString()],
    );
    for (const table of TABLES) {
      counts[table] = await importTable(sqlite, postgres, input.organization, table);
    }
    await postgres.query("COMMIT");
    return { path: sqlitePath, organization: input.organization, rows: counts };
  } catch (error) {
    await postgres.query("ROLLBACK");
    throw error;
  } finally {
    postgres.release();
    await pool.end();
    sqlite.close();
  }
}
