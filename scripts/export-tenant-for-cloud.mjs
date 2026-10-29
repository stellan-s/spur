#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";

import pg from "pg";

const TABLES = [
  "sources",
  "evidence",
  "memory_objects",
  "memory_aliases",
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
];

function usage() {
  console.error(
    "Usage: node scripts/export-tenant-for-cloud.mjs ENV_FILE SOURCE_SLUG TARGET_SLUG TARGET_NAME OUTPUT.sql",
  );
  process.exit(2);
}

function validateSlug(value, name) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    throw new Error(`${name} must be a lowercase organization slug.`);
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteString(value) {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `E'${escaped}'`;
}

function sqlValue(value, dataType) {
  if (value === null || value === undefined) return "NULL";
  if (dataType === "json" || dataType === "jsonb") {
    return `${quoteString(JSON.stringify(value))}::${dataType}`;
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot export non-finite number ${value}.`);
    return String(value);
  }
  return quoteString(String(value));
}

function cloudSourceMetadata(metadata) {
  const cleaned = { ...(metadata ?? {}) };
  delete cleaned.credential_env;
  delete cleaned.repository_root;
  const remote = typeof cleaned.remote_url === "string" ? cleaned.remote_url : "";
  const match = remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) return cleaned;
  cleaned.provider = "github";
  cleaned.authentication = "github_app";
  cleaned.github_owner = match[1];
  cleaned.github_repository = match[2];
  cleaned.repository_root = `github://${match[1]}/${match[2]}`;
  return cleaned;
}

const [envArgument, sourceSlug, targetSlug, targetName, outputArgument] = process.argv.slice(2);
if (!envArgument || !sourceSlug || !targetSlug || !targetName || !outputArgument) usage();
validateSlug(sourceSlug, "SOURCE_SLUG");
validateSlug(targetSlug, "TARGET_SLUG");
if (sourceSlug === targetSlug) throw new Error("SOURCE_SLUG and TARGET_SLUG must differ.");

const envFile = path.resolve(envArgument);
const output = path.resolve(outputArgument);
const environment = parseEnv(await readFile(envFile, "utf8"));
if (!environment.DATABASE_URL) throw new Error(`${envFile} does not define DATABASE_URL.`);

const client = new pg.Client({ connectionString: environment.DATABASE_URL });
await client.connect();

try {
  const organization = await client.query(
    "SELECT id, name FROM organizations WHERE id = $1",
    [sourceSlug],
  );
  if (organization.rowCount !== 1) throw new Error(`Organization '${sourceSlug}' does not exist.`);

  const lines = [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '15min';",
    "",
    "-- Refuse to merge into an existing model. Identity and access tables are intentionally ignored.",
    "DO $spur$",
    "BEGIN",
    `  IF EXISTS (${TABLES.map((table) =>
      `SELECT 1 FROM public.${quoteIdentifier(table)} WHERE organization_id = ${quoteString(targetSlug)}`
    ).join(" UNION ALL ")}) THEN`,
    `    RAISE EXCEPTION 'Target organization ${targetSlug} already contains model data.';`,
    "  END IF;",
    "END",
    "$spur$;",
    "",
    `INSERT INTO public.organizations (id, name, created_at, updated_at)`,
    `VALUES (${quoteString(targetSlug)}, ${quoteString(targetName)}, NOW()::text, NOW()::text)`,
    `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at;`,
    "",
  ];

  const counts = {};
  for (const table of TABLES) {
    const columnResult = await client.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    if (columnResult.rowCount === 0) throw new Error(`Table public.${table} does not exist.`);
    const columns = columnResult.rows;
    const data = await client.query(
      `SELECT * FROM public.${quoteIdentifier(table)} WHERE organization_id = $1`,
      [sourceSlug],
    );
    counts[table] = data.rowCount;
    if (data.rowCount === 0) continue;

    const columnSql = columns.map(({ column_name }) => quoteIdentifier(column_name)).join(", ");
    const batchSize = 100;
    for (let offset = 0; offset < data.rows.length; offset += batchSize) {
      const batch = data.rows.slice(offset, offset + batchSize);
      const values = batch.map((original) => {
        const row = { ...original, organization_id: targetSlug };
        if (table === "sources") row.metadata_json = cloudSourceMetadata(row.metadata_json);
        return `(${columns.map(({ column_name, data_type }) =>
          sqlValue(row[column_name], data_type)).join(", ")})`;
      });
      lines.push(
        `INSERT INTO public.${quoteIdentifier(table)} (${columnSql}) VALUES`,
        values.join(",\n"),
        "ON CONFLICT DO NOTHING;",
        "",
      );
    }
  }

  lines.push(
    "COMMIT;",
    "",
    `SELECT 'Imported ${targetSlug}' AS result;`,
    ...TABLES.map((table) =>
      `SELECT ${quoteString(table)} AS table_name, count(*) AS row_count FROM public.${quoteIdentifier(table)} WHERE organization_id = ${quoteString(targetSlug)};`
    ),
    "",
  );

  await writeFile(output, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Wrote tenant-safe export to ${output}`);
  for (const table of TABLES) console.log(`${table}\t${counts[table]}`);
} finally {
  await client.end();
}
