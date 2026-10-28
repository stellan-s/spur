import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { sharedPool } from "./db-pool";
import type { Evidence } from "./types";
import { InputError, NotFoundError } from "./errors";
import {
  knowledgeGapSchema,
  type KnowledgeGap,
  type KnowledgeGapFilter,
  type UpdateKnowledgeGapInput,
} from "./knowledge-gap-types";
import {
  ismsControlSchema,
  ismsControlRevisionSchema,
  type IsmsControl,
  type IsmsControlInput,
  type IsmsControlRevision,
} from "./isms-types";
import { queryKeywords, queryTerms } from "./search";
import { isRestrictedMemory, isSecurityIssueMemory } from "./security-disclosure";
import {
  entityDefinitionSchema,
  memoryAliasSchema,
  memoryObjectSchema,
  memoryRelationshipSchema,
  sourceAnalysisRunSchema,
  sourceSchema,
  storedEvidenceSchema,
  type ConversationSummary,
  type MemoryAlias,
  type MemoryAliasOrigin,
  type MemoryAliasScope,
  type MemoryAliasStatus,
  type MemoryKind,
  type MemoryObject,
  type MemoryRelationship,
  type Source,
  type SourceAnalysisRun,
  type SourceKind,
  type StoredEvidence,
} from "./memory-types";

type JsonRecord = Record<string, unknown>;
type Queryable = Pool | PoolClient;

type MemoryWrite = {
  kind: MemoryKind;
  title: string;
  statement: string;
  state: MemoryObject["state"];
  authority: MemoryObject["authority"];
  confidence: number;
  subjects?: string[];
  evidenceIds?: string[];
  sourceIds?: string[];
  sourceVersion?: string | null;
  actor?: string | null;
  metadata?: JsonRecord;
};

type MemoryAliasWrite = {
  memoryId: string;
  name: string;
  status: MemoryAliasStatus;
  origin: MemoryAliasOrigin;
  scope: MemoryAliasScope;
  sourceId?: string | null;
  sourceVersion?: string | null;
  evidenceIds?: string[];
  actor?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  metadata?: JsonRecord;
};

export type StoredInvestigation = {
  id: string;
  question: string;
  answer: string;
  analysis: unknown;
  recalledMemoryIds: string[];
  learnedMemoryIds: string[];
  createdAt: string;
};

export type StoredConversation = ConversationSummary & {
  investigationIds: string[];
};

function now(): string {
  return new Date().toISOString();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function memoryFingerprint(kind: MemoryKind, statement: string, sourceVersion: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify({
      kind,
      statement: statement.trim().toLowerCase(),
      sourceVersion: kind === "application" ? null : sourceVersion,
    }))
    .digest("hex");
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as unknown;
}

function parseRecord(value: unknown): JsonRecord {
  const parsed = parseJson(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as JsonRecord
    : {};
}

function parseStrings(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function mergeEntityDefinitions(targetValue: unknown, sourceValue: unknown): unknown {
  if (sourceValue === undefined) return targetValue;
  if (targetValue === undefined) return entityDefinitionSchema.parse(sourceValue);
  const target = entityDefinitionSchema.parse(targetValue);
  const source = entityDefinitionSchema.parse(sourceValue);
  if (target.technical_name && source.technical_name && target.technical_name !== source.technical_name) {
    throw new InputError("Entity technical names conflict. Resolve them before merging.");
  }
  if (target.information_classification && source.information_classification &&
      target.information_classification !== source.information_classification) {
    throw new InputError("Entity information classifications conflict. Resolve them before merging.");
  }
  const attributes = new Map(target.attributes.map((attribute) => [attribute.name.toLocaleLowerCase(), attribute]));
  for (const attribute of source.attributes) {
    const key = attribute.name.toLocaleLowerCase();
    const existing = attributes.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(attribute)) {
      throw new InputError(`Entity attribute ${attribute.name} conflicts. Resolve it before merging.`);
    }
    attributes.set(key, attribute);
  }
  const locations = new Map(target.data_locations.map((location) =>
    [`${location.system}\u0000${location.locator}`.toLocaleLowerCase(), location]));
  for (const location of source.data_locations) {
    const key = `${location.system}\u0000${location.locator}`.toLocaleLowerCase();
    const existing = locations.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(location)) {
      throw new InputError(`Entity data location ${location.locator} conflicts. Resolve it before merging.`);
    }
    locations.set(key, location);
  }
  return entityDefinitionSchema.parse({
    technical_name: target.technical_name ?? source.technical_name,
    information_classification: target.information_classification ?? source.information_classification,
    attributes: [...attributes.values()],
    data_locations: [...locations.values()],
  });
}

function normalizedSearchText(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function normalizedQuestionKey(value: string): string {
  return normalizedSearchText(value).match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? "";
}

function rowToSource(row: QueryResultRow): Source {
  return sourceSchema.parse({
    ...row,
    enabled: Boolean(row.enabled),
    metadata: parseRecord(row.metadata_json),
  });
}

function rowToMemory(row: QueryResultRow, aliases?: MemoryAlias[]): MemoryObject {
  const storedAliases = aliases ?? (
    Array.isArray(parseJson(row.aliases_json))
      ? (parseJson(row.aliases_json) as QueryResultRow[]).map(rowToMemoryAlias)
      : []
  );
  return memoryObjectSchema.parse({
    ...row,
    confidence: Number(row.confidence),
    subjects: parseStrings(row.subjects_json),
    evidence_ids: parseStrings(row.evidence_ids_json),
    source_ids: parseStrings(row.source_ids_json),
    metadata: parseRecord(row.metadata_json),
    aliases: storedAliases,
  });
}

function rowToMemoryAlias(row: QueryResultRow): MemoryAlias {
  return memoryAliasSchema.parse({
    ...row,
    evidence_ids: parseStrings(row.evidence_ids_json),
    metadata: parseRecord(row.metadata_json),
  });
}

function rowToRelationship(row: QueryResultRow): MemoryRelationship {
  return memoryRelationshipSchema.parse({
    ...row,
    metadata: parseRecord(row.metadata_json),
  });
}

function rowToKnowledgeGap(row: QueryResultRow): KnowledgeGap {
  return knowledgeGapSchema.parse({
    ...row,
    times_asked: Number(row.times_asked),
    history: parseJson(row.history_json),
  });
}

function rowToSourceAnalysisRun(
  row: QueryResultRow,
  counts: { objects: number; relationships: number; evidence: number },
): SourceAnalysisRun {
  return sourceAnalysisRunSchema.parse({
    ...row,
    object_count: counts.objects,
    relationship_count: counts.relationships,
    evidence_count: counts.evidence,
  });
}

/** PostgreSQL-backed, organisation-scoped persistence. Migrations run only through `spur migrate`. */
export class PostgresMemoryStore {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly ready: Promise<void>;

  constructor(
    readonly databaseUrl: string,
    readonly organizationId: string,
    organizationName = organizationId,
    pool?: Pool,
    managedOrganization = false,
  ) {
    this.pool = pool ?? sharedPool(databaseUrl);
    this.ownsPool = false;
    const timestamp = now();
    this.ready = managedOrganization ? this.pool.query(
      "SELECT organization_id FROM organization_settings WHERE organization_id = $1", [organizationId],
    ).then((result) => {
      if (!result.rowCount) throw new NotFoundError("Organisation was not found.");
    }) : this.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
      [organizationId, organizationName, timestamp],
    ).then(() => undefined);
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    if (this.ownsPool) await this.pool.end();
  }

  private async query<T extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
    database: Queryable = this.pool,
  ): Promise<T[]> {
    await this.ready;
    return (await database.query<T>(text, values)).rows;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async memoryRows(
    rows: QueryResultRow[],
    database: Queryable = this.pool,
  ): Promise<MemoryObject[]> {
    if (!rows.length) return [];
    const memoryIds = rows.map((row) => String(row.id));
    const aliasRows = await this.query(
      `SELECT * FROM memory_aliases
       WHERE organization_id = $1 AND memory_id = ANY($2::text[])
       ORDER BY created_at, id`,
      [this.organizationId, memoryIds],
      database,
    );
    const aliasesByMemory = new Map<string, MemoryAlias[]>();
    for (const alias of aliasRows.map(rowToMemoryAlias)) {
      const aliases = aliasesByMemory.get(alias.memory_id) ?? [];
      aliases.push(alias);
      aliasesByMemory.set(alias.memory_id, aliases);
    }
    return rows.map((row) => rowToMemory(row, aliasesByMemory.get(String(row.id)) ?? []));
  }

  async upsertSource(input: {
    id?: string;
    kind: SourceKind;
    name: string;
    locator: string;
    status: Source["status"];
    enabled?: boolean;
    lastSyncedAt?: string | null;
    metadata?: JsonRecord;
    restoreRemoved?: boolean;
  }, database: Queryable = this.pool): Promise<Source> {
    const timestamp = now();
    const id = input.id ?? stableId("src", `${input.kind}:${input.locator}`);
    await this.query(
      `INSERT INTO sources (
        organization_id, id, kind, name, locator, status, enabled, last_synced_at,
        created_at, updated_at, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10::jsonb)
      ON CONFLICT(organization_id, id) DO UPDATE SET
        kind = EXCLUDED.kind, name = EXCLUDED.name, locator = EXCLUDED.locator,
        status = EXCLUDED.status, enabled = EXCLUDED.enabled,
        last_synced_at = EXCLUDED.last_synced_at, updated_at = EXCLUDED.updated_at,
        metadata_json = EXCLUDED.metadata_json
      WHERE NOT (sources.metadata_json ? 'removed_at') OR $11`,
      [this.organizationId, id, input.kind, input.name, input.locator, input.status,
        input.enabled !== false, input.lastSyncedAt ?? null, timestamp,
        JSON.stringify(input.metadata ?? {}), input.restoreRemoved === true],
      database,
    );
    return (await this.getSource(id, database))!;
  }

  async getSource(id: string, database: Queryable = this.pool): Promise<Source | null> {
    const [row] = await this.query(
      "SELECT * FROM sources WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return row ? rowToSource(row) : null;
  }

  async listSources(options: { includeRemoved?: boolean } = {}, database: Queryable = this.pool): Promise<Source[]> {
    const rows = await this.query(
      `SELECT * FROM sources WHERE organization_id = $1
       AND ($2 OR NOT (metadata_json ? 'removed_at')) ORDER BY enabled DESC, updated_at DESC`,
      [this.organizationId, options.includeRemoved === true],
      database,
    );
    return rows.map(rowToSource);
  }

  private async sourceAnalysisRunCounts(
    runId: string,
    database: Queryable = this.pool,
  ): Promise<{ objects: number; relationships: number; evidence: number }> {
    const mappedRows = await this.query<{ memory_id: string }>(
      `SELECT memory_id FROM source_analysis_run_objects
       WHERE organization_id = $1 AND run_id = $2`,
      [this.organizationId, runId],
      database,
    );
    const evidenceIds = new Set<string>();
    for (const { memory_id: memoryId } of mappedRows) {
      const memory = await this.getMemory(memoryId, database);
      for (const evidenceId of memory?.evidence_ids ?? []) evidenceIds.add(evidenceId);
      for (const alias of memory?.aliases ?? []) {
        for (const evidenceId of alias.evidence_ids) evidenceIds.add(evidenceId);
      }
    }
    const [relationshipRow] = await this.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM source_analysis_run_relationships
       WHERE organization_id = $1 AND run_id = $2`,
      [this.organizationId, runId],
      database,
    );
    return {
      objects: mappedRows.length,
      relationships: Number(relationshipRow?.count ?? 0),
      evidence: evidenceIds.size,
    };
  }

  async beginSourceAnalysis(input: {
    sourceId: string;
    sourceVersion: string;
    idempotencyKey: string;
    clientName: string;
    clientVersion?: string;
    model?: string;
  }): Promise<SourceAnalysisRun> {
    const [existing] = await this.query(
      `SELECT * FROM source_analysis_runs
       WHERE organization_id = $1 AND source_id = $2 AND source_version = $3
         AND idempotency_key = $4`,
      [this.organizationId, input.sourceId, input.sourceVersion, input.idempotencyKey],
    );
    if (existing) {
      return rowToSourceAnalysisRun(existing, await this.sourceAnalysisRunCounts(String(existing.id)));
    }
    const id = `run_${randomUUID()}`;
    await this.query(
      `INSERT INTO source_analysis_runs (
        organization_id, id, source_id, source_version, idempotency_key, client_name,
        client_version, model, status, created_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, NULL)`,
      [this.organizationId, id, input.sourceId, input.sourceVersion, input.idempotencyKey,
        input.clientName, input.clientVersion ?? null, input.model ?? null, now()],
    );
    return (await this.getSourceAnalysisRun(id))!;
  }

  async getSourceAnalysisRun(
    id: string,
    database: Queryable = this.pool,
  ): Promise<SourceAnalysisRun | null> {
    const [row] = await this.query(
      "SELECT * FROM source_analysis_runs WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return row ? rowToSourceAnalysisRun(row, await this.sourceAnalysisRunCounts(id, database)) : null;
  }

  async mapSourceAnalysisObject(runId: string, externalId: string, memoryId: string): Promise<void> {
    await this.query(
      `INSERT INTO source_analysis_run_objects (organization_id, run_id, external_id, memory_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(organization_id, run_id, external_id)
       DO UPDATE SET memory_id = EXCLUDED.memory_id`,
      [this.organizationId, runId, externalId, memoryId],
    );
  }

  async resolveSourceAnalysisObject(runId: string, externalId: string): Promise<MemoryObject | null> {
    const [row] = await this.query<{ memory_id: string }>(
      `SELECT memory_id FROM source_analysis_run_objects
       WHERE organization_id = $1 AND run_id = $2 AND external_id = $3`,
      [this.organizationId, runId, externalId],
    );
    return row ? this.getMemory(row.memory_id) : null;
  }

  async mapSourceAnalysisRelationship(runId: string, relationshipId: string): Promise<void> {
    await this.query(
      `INSERT INTO source_analysis_run_relationships (organization_id, run_id, relationship_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [this.organizationId, runId, relationshipId],
    );
  }

  async completeSourceAnalysis(id: string): Promise<SourceAnalysisRun | null> {
    await this.query(
      `UPDATE source_analysis_runs SET status = 'completed', completed_at = COALESCE(completed_at, $3)
       WHERE organization_id = $1 AND id = $2`,
      [this.organizationId, id, now()],
    );
    return this.getSourceAnalysisRun(id);
  }

  async markRepositoryActive(activeId: string): Promise<void> {
    for (const source of await this.listSources()) {
      if (source.kind !== "repository" || source.id === activeId ||
          (source.id !== "src_configured_repository" && source.metadata.active !== true)) continue;
      await this.upsertSource({
        id: source.id,
        kind: source.kind,
        name: source.name,
        locator: source.locator,
        status: "configured",
        enabled: false,
        lastSyncedAt: source.last_synced_at,
        metadata: { ...source.metadata, active: false },
      });
    }
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<Source | null> {
    const [row] = await this.query(
      `UPDATE sources SET enabled = $3, status = $4, updated_at = $5
       WHERE organization_id = $1 AND id = $2 AND NOT (metadata_json ? 'removed_at')
       RETURNING *`,
      [this.organizationId, id, enabled, enabled ? "configured" : "disabled", now()],
    );
    return row ? rowToSource(row) : null;
  }

  async removeSource(id: string, actor: string): Promise<Source | null> {
    // Keep the row for evidence and analysis-run references; automatic sync must not restore it.
    const [row] = await this.query(
      `UPDATE sources SET enabled = FALSE, status = 'disabled', updated_at = $3,
       metadata_json = metadata_json || jsonb_build_object(
         'active', FALSE, 'removed_at', COALESCE(metadata_json->>'removed_at', $3::text),
         'removed_by', COALESCE(metadata_json->>'removed_by', $4::text))
       WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [this.organizationId, id, now(), actor],
    );
    return row ? rowToSource(row) : null;
  }

  async storeEvidence(sourceId: string, evidence: Evidence): Promise<StoredEvidence> {
    const id = stableId("ev", [sourceId, evidence.commit_sha, evidence.path,
      evidence.start_line, evidence.end_line, evidence.excerpt].join(":"));
    await this.query(
      `INSERT INTO evidence (
        organization_id, id, source_id, source_version, path, start_line, end_line,
        excerpt, kind, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT(organization_id, id) DO NOTHING`,
      [this.organizationId, id, sourceId, evidence.commit_sha, evidence.path,
        evidence.start_line, evidence.end_line, evidence.excerpt, evidence.kind, now()],
    );
    return (await this.getEvidence(id))!;
  }

  async getEvidence(id: string, database: Queryable = this.pool): Promise<StoredEvidence | null> {
    const [row] = await this.query(
      "SELECT * FROM evidence WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return row ? storedEvidenceSchema.parse(row) : null;
  }

  async upsertMemory(input: MemoryWrite, database: Queryable = this.pool): Promise<MemoryObject> {
    const fingerprint = memoryFingerprint(input.kind, input.statement, input.sourceVersion ?? null);
    const fingerprintId = stableId("mem", fingerprint);
    const [existingRow] = await this.query<{ id: string }>(
      "SELECT id FROM memory_objects WHERE organization_id = $1 AND fingerprint = $2",
      [this.organizationId, fingerprint],
      database,
    );
    const existing = existingRow ? await this.getMemory(existingRow.id, database) : null;
    const restricted = existing?.metadata.sensitivity === "restricted" ||
      input.metadata?.sensitivity === "restricted";
    const [merged] = await this.query<{ target_id: string }>(
      "SELECT target_id FROM memory_merges WHERE organization_id = $1 AND source_id = $2",
      [this.organizationId, fingerprintId],
      database,
    );
    if (merged) {
      const target = await this.getMemory(merged.target_id, database);
      if (!target || target.metadata.deleted_at) {
        throw new InputError("The merged target is unavailable. Review the merge before modelling again.");
      }
      if (restricted && target.metadata.sensitivity !== "restricted") {
        await this.updateMemory(target.id, {
          metadata: { ...target.metadata, sensitivity: "restricted" },
        }, database);
      }
      await this.query(
        `UPDATE memory_objects SET subjects_json = $3::jsonb, evidence_ids_json = $4::jsonb,
          source_ids_json = $5::jsonb, updated_at = $6
         WHERE organization_id = $1 AND id = $2`,
        [this.organizationId, target.id,
          JSON.stringify([...new Set([...target.subjects, ...(input.subjects ?? [])])]),
          JSON.stringify([...new Set([...target.evidence_ids, ...(input.evidenceIds ?? [])])]),
          JSON.stringify([...new Set([...target.source_ids, ...(input.sourceIds ?? [])])]), now()],
        database,
      );
      return (await this.getMemory(target.id, database))!;
    }

    const id = existing?.id ?? fingerprintId;
    const timestamp = now();
    const subjects = restricted
      ? [...new Set([...(existing?.subjects ?? []), ...(input.subjects ?? [])])]
      : input.subjects ?? [];
    const evidenceIds = restricted
      ? [...new Set([...(existing?.evidence_ids ?? []), ...(input.evidenceIds ?? [])])]
      : input.evidenceIds ?? [];
    const sourceIds = restricted
      ? [...new Set([...(existing?.source_ids ?? []), ...(input.sourceIds ?? [])])]
      : input.sourceIds ?? [];
    const metadata = restricted
      ? { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}), sensitivity: "restricted" }
      : input.metadata ?? {};
    await this.query(
      `INSERT INTO memory_objects (
        organization_id, id, fingerprint, kind, title, statement, state, authority, confidence,
        subjects_json, evidence_ids_json, source_ids_json, source_version, actor,
        created_at, updated_at, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
        $12::jsonb, $13, $14, $15, $15, $16::jsonb)
      ON CONFLICT(organization_id, fingerprint) DO UPDATE SET
        title = EXCLUDED.title, state = EXCLUDED.state, authority = EXCLUDED.authority,
        confidence = EXCLUDED.confidence, subjects_json = EXCLUDED.subjects_json,
        evidence_ids_json = EXCLUDED.evidence_ids_json, source_ids_json = EXCLUDED.source_ids_json,
        source_version = EXCLUDED.source_version,
        actor = COALESCE(EXCLUDED.actor, memory_objects.actor),
        updated_at = EXCLUDED.updated_at, metadata_json = EXCLUDED.metadata_json`,
      [this.organizationId, id, fingerprint, input.kind, input.title.trim(), input.statement.trim(),
        input.state, input.authority, input.confidence, JSON.stringify(subjects),
        JSON.stringify(evidenceIds), JSON.stringify(sourceIds), input.sourceVersion ?? null,
        input.actor ?? null, timestamp, JSON.stringify(metadata)],
      database,
    );
    return (await this.getMemory(id, database))!;
  }

  async getMemory(id: string, database: Queryable = this.pool): Promise<MemoryObject | null> {
    const [row] = await this.query(
      `SELECT memory_objects.*,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(memory_aliases) ORDER BY created_at, id)
          FROM memory_aliases
          WHERE memory_aliases.organization_id = memory_objects.organization_id
            AND memory_aliases.memory_id = memory_objects.id
        ), '[]'::jsonb) AS aliases_json
       FROM memory_objects WHERE organization_id = $1 AND id = $2`,
      [this.organizationId, id],
      database,
    );
    return row ? rowToMemory(row) : null;
  }

  async getMemoryAlias(id: string, database: Queryable = this.pool): Promise<MemoryAlias | null> {
    const [row] = await this.query(
      "SELECT * FROM memory_aliases WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return row ? rowToMemoryAlias(row) : null;
  }

  async listMemoryAliases(
    memoryId: string,
    database: Queryable = this.pool,
  ): Promise<MemoryAlias[]> {
    const rows = await this.query(
      `SELECT * FROM memory_aliases
       WHERE organization_id = $1 AND memory_id = $2
       ORDER BY created_at, id`,
      [this.organizationId, memoryId],
      database,
    );
    return rows.map(rowToMemoryAlias);
  }

  async upsertMemoryAlias(
    input: MemoryAliasWrite,
    database: Queryable = this.pool,
  ): Promise<MemoryAlias> {
    const normalizedName = normalizedQuestionKey(input.name);
    if (!normalizedName) throw new InputError("Alias must contain letters or numbers.");
    if (input.scope === "repository" && !input.sourceId) {
      throw new InputError("Repository aliases require a source.");
    }
    if (input.origin === "repository" && !input.sourceId) {
      throw new InputError("Repository-derived aliases require a source.");
    }
    const id = stableId("alias", [
      input.memoryId,
      normalizedName,
      input.origin,
      input.sourceId ?? "",
      input.actor ?? "",
    ].join(":"));
    const existing = await this.getMemoryAlias(id, database);
    const timestamp = now();
    const evidenceIds = [...new Set([
      ...(existing?.evidence_ids ?? []),
      ...(input.evidenceIds ?? []),
    ])];
    await this.query(
      `INSERT INTO memory_aliases (
        organization_id, id, memory_id, name, normalized_name, status, origin, scope,
        source_id, source_version, evidence_ids_json, actor, created_at, updated_at,
        reviewed_at, reviewed_by, review_note, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12,
        $13, $14, $15, $16, $17, $18::jsonb)
      ON CONFLICT(organization_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        source_version = COALESCE(EXCLUDED.source_version, memory_aliases.source_version),
        evidence_ids_json = EXCLUDED.evidence_ids_json,
        updated_at = EXCLUDED.updated_at,
        metadata_json = memory_aliases.metadata_json || EXCLUDED.metadata_json`,
      [this.organizationId, id, input.memoryId, input.name.trim(), normalizedName,
        input.status, input.origin, input.scope, input.sourceId ?? null,
        input.sourceVersion ?? null, JSON.stringify(evidenceIds), input.actor ?? null,
        existing?.created_at ?? timestamp, timestamp, input.reviewedAt ?? null,
        input.reviewedBy ?? null, input.reviewNote ?? null,
        JSON.stringify(input.metadata ?? {})],
      database,
    );
    return (await this.getMemoryAlias(id, database))!;
  }

  async reviewMemoryAlias(
    memoryId: string,
    aliasId: string,
    status: Extract<MemoryAliasStatus, "verified" | "rejected">,
    actor: string,
    note: string,
  ): Promise<MemoryAlias> {
    const timestamp = now();
    const [row] = await this.query(
      `UPDATE memory_aliases SET status = $4, reviewed_at = $5, reviewed_by = $6,
        review_note = $7, updated_at = $5
       WHERE organization_id = $1 AND memory_id = $2 AND id = $3
       RETURNING *`,
      [this.organizationId, memoryId, aliasId, status, timestamp, actor, note.trim()],
    );
    if (!row) throw new NotFoundError("Alias was not found.");
    return rowToMemoryAlias(row);
  }

  async updateMemory(
    id: string,
    input: Partial<{
      kind: MemoryKind;
      title: string;
      statement: string;
      state: MemoryObject["state"];
      authority: MemoryObject["authority"];
      confidence: number;
      subjects: string[];
      actor: string | null;
      metadata: JsonRecord;
    }>,
    database: Queryable = this.pool,
  ): Promise<MemoryObject | null> {
    const current = await this.getMemory(id, database);
    if (!current) return null;
    const kind = input.kind ?? current.kind;
    const statement = input.statement?.trim() ?? current.statement;
    const metadata = current.metadata.sensitivity === "restricted"
      ? { ...(input.metadata ?? current.metadata), sensitivity: "restricted" }
      : input.metadata ?? current.metadata;
    await this.query(
      `UPDATE memory_objects SET fingerprint = $3, kind = $4, title = $5, statement = $6,
        state = $7, authority = $8, confidence = $9, subjects_json = $10::jsonb,
        actor = $11, updated_at = $12, metadata_json = $13::jsonb
       WHERE organization_id = $1 AND id = $2`,
      [this.organizationId, id, memoryFingerprint(kind, statement, current.source_version), kind,
        input.title?.trim() ?? current.title, statement, input.state ?? current.state,
        input.authority ?? current.authority, input.confidence ?? current.confidence,
        JSON.stringify(input.subjects ?? current.subjects),
        input.actor === undefined ? current.actor : input.actor, now(), JSON.stringify(metadata)],
      database,
    );
    return this.getMemory(id, database);
  }

  async mergeMemory(sourceId: string, targetId: string, actor: string): Promise<MemoryObject> {
    return this.transaction(async (client) => {
      if (sourceId === targetId) throw new InputError("Choose two different catalog objects.");
      const source = await this.getMemory(sourceId, client);
      const target = await this.getMemory(targetId, client);
      if (!source || !target || source.metadata.deleted_at || target.metadata.deleted_at) {
        throw new NotFoundError("Both catalog objects must be active.");
      }
      if (source.kind !== target.kind) {
        throw new InputError("Only catalog objects of the same type can be merged.");
      }
      if (source.metadata.configured_source === true || target.metadata.configured_source === true) {
        throw new InputError("Connected applications are managed from Sources and cannot be merged.");
      }
      if ((await this.listIsmsControls(false, client))
        .some((control) => control.linked_memory_ids.includes(sourceId))) {
        throw new InputError("This object is linked to an active ISMS control. Update that mapping before merging.");
      }
      const entityDefinition = source.kind === "entity"
        ? mergeEntityDefinitions(target.metadata.entity_definition, source.metadata.entity_definition)
        : undefined;
      const timestamp = now();
      const earlierSources = await this.query<{ source_id: string }>(
        "SELECT source_id FROM memory_merges WHERE organization_id = $1 AND target_id = $2",
        [this.organizationId, sourceId],
        client,
      );
      const mergedFromIds = [...new Set([
        ...(Array.isArray(target.metadata.merged_from_ids)
          ? target.metadata.merged_from_ids.filter((id): id is string => typeof id === "string") : []),
        sourceId,
        ...earlierSources.map((row) => row.source_id),
      ])];
      await this.query(
        `UPDATE memory_objects SET subjects_json = $3::jsonb, evidence_ids_json = $4::jsonb,
          source_ids_json = $5::jsonb, metadata_json = $6::jsonb, updated_at = $7
         WHERE organization_id = $1 AND id = $2`,
        [this.organizationId, targetId,
          JSON.stringify([...new Set([...target.subjects, ...source.subjects])]),
          JSON.stringify([...new Set([...target.evidence_ids, ...source.evidence_ids])]),
          JSON.stringify([...new Set([...target.source_ids, ...source.source_ids])]),
          JSON.stringify({
            ...target.metadata,
            ...(source.metadata.sensitivity === "restricted" || target.metadata.sensitivity === "restricted"
              ? { sensitivity: "restricted" } : {}),
            ...(source.kind === "entity" && entityDefinition !== undefined
              ? { entity_definition: entityDefinition } : {}),
            merged_from_ids: mergedFromIds,
            last_merged_at: timestamp,
            last_merged_by: actor,
          }), timestamp],
        client,
      );
      for (const relationship of await this.listRelationships(sourceId, client)) {
        const fromId = relationship.from_id === sourceId ? targetId : relationship.from_id;
        const toId = relationship.to_id === sourceId ? targetId : relationship.to_id;
        if (fromId === toId) continue;
        const [existingRelationship] = await this.query<{ id: string }>(
          `SELECT id FROM relationships
           WHERE organization_id = $1 AND from_id = $2 AND predicate = $3 AND to_id = $4`,
          [this.organizationId, fromId, relationship.predicate, toId],
          client,
        );
        if (!existingRelationship) {
          await this.link(fromId, relationship.predicate, toId, relationship.metadata, client);
        }
      }
      for (const alias of await this.listMemoryAliases(sourceId, client)) {
        await this.upsertMemoryAlias({
          memoryId: targetId,
          name: alias.name,
          status: alias.status,
          origin: alias.origin,
          scope: alias.scope,
          sourceId: alias.source_id,
          sourceVersion: alias.source_version,
          evidenceIds: alias.evidence_ids,
          actor: alias.actor,
          reviewedAt: alias.reviewed_at,
          reviewedBy: alias.reviewed_by,
          reviewNote: alias.review_note,
          metadata: alias.metadata,
        }, client);
      }
      await this.query(
        "DELETE FROM memory_aliases WHERE organization_id = $1 AND memory_id = $2",
        [this.organizationId, sourceId],
        client,
      );
      await this.updateMemory(sourceId, {
        state: "deleted",
        metadata: {
          ...source.metadata,
          deleted_at: timestamp,
          deleted_by: actor,
          state_before_delete: source.state,
          merged_into_id: targetId,
        },
      }, client);
      await this.query(
        "UPDATE memory_merges SET target_id = $3 WHERE organization_id = $1 AND target_id = $2",
        [this.organizationId, sourceId, targetId],
        client,
      );
      await this.query(
        `INSERT INTO memory_merges (organization_id, source_id, target_id, merged_at, merged_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [this.organizationId, sourceId, targetId, timestamp, actor],
        client,
      );
      return (await this.getMemory(targetId, client))!;
    });
  }

  async appendEvidence(id: string, evidenceIds: string[], sourceId: string): Promise<MemoryObject | null> {
    const current = await this.getMemory(id);
    if (!current) return null;
    await this.query(
      `UPDATE memory_objects SET evidence_ids_json = $3::jsonb, source_ids_json = $4::jsonb,
        updated_at = $5 WHERE organization_id = $1 AND id = $2`,
      [this.organizationId, id, JSON.stringify([...new Set([...current.evidence_ids, ...evidenceIds])]),
        JSON.stringify([...new Set([...current.source_ids, sourceId])]), now()],
    );
    return this.getMemory(id);
  }

  async recordKnowledgeGap(question: string, reason: string, actor = "Spur"): Promise<KnowledgeGap> {
    const normalized = question.trim().replace(/\s+/g, " ");
    const id = stableId("gap", normalized.toLowerCase());
    const timestamp = now();
    const rows = await this.query(
      `INSERT INTO knowledge_gaps (
        organization_id, id, question, reason, times_asked, first_asked_at, last_asked_at
      ) VALUES ($1, $2, $3, $4, 1, $5, $5)
      ON CONFLICT(organization_id, id) DO UPDATE SET
        reason = EXCLUDED.reason,
        times_asked = knowledge_gaps.times_asked + 1,
        last_asked_at = EXCLUDED.last_asked_at,
        status = 'open',
        history_json = CASE WHEN knowledge_gaps.status = 'resolved'
          THEN knowledge_gaps.history_json || $6::jsonb ELSE knowledge_gaps.history_json END
      RETURNING *`,
      [this.organizationId, id, normalized, reason.trim(), timestamp, JSON.stringify([{
        action: "reopen", note: "Question was logged as unanswered again.",
        memory_ids: [], actor, created_at: timestamp,
      }])],
    );
    return rowToKnowledgeGap(rows[0]);
  }

  async getKnowledgeGap(id: string): Promise<KnowledgeGap | null> {
    const rows = await this.query(
      "SELECT * FROM knowledge_gaps WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
    );
    return rows[0] ? rowToKnowledgeGap(rows[0]) : null;
  }

  async updateKnowledgeGap(id: string, input: UpdateKnowledgeGapInput, actor: string): Promise<KnowledgeGap> {
    return this.transaction(async (client) => {
      const [existing] = await this.query(
        "SELECT * FROM knowledge_gaps WHERE organization_id = $1 AND id = $2 FOR UPDATE",
        [this.organizationId, id], client,
      );
      if (!existing) throw new NotFoundError("Knowledge gap was not found.");
      const status = input.action === "resolve" ? "resolved" : "open";
      if (existing.status === status) throw new InputError(`Knowledge gap is already ${status}. Refresh and try again.`);
      const memoryIds = input.action === "resolve" ? [...new Set(input.memory_ids)] : [];
      if (input.action === "resolve") {
        const rows = await this.query(
          "SELECT * FROM memory_objects WHERE organization_id = $1 AND id = ANY($2::text[]) ORDER BY id FOR SHARE",
          [this.organizationId, memoryIds], client,
        );
        const items = rows.map((row) => rowToMemory(row));
        if (!items.length || items.length !== memoryIds.length || items.some((item) =>
          item.metadata.deleted_at || !["accepted", "candidate"].includes(item.state) ||
          isRestrictedMemory(item) || isSecurityIssueMemory(item))) {
          throw new InputError("Supporting knowledge must be active, non-restricted catalog items in this organization.");
        }
      }
      const event = {
        action: input.action, note: input.note,
        memory_ids: memoryIds,
        actor, created_at: now(),
      };
      const [updated] = await this.query(
        `UPDATE knowledge_gaps SET status = $3, history_json = history_json || $4::jsonb
         WHERE organization_id = $1 AND id = $2 RETURNING *`,
        [this.organizationId, id, status, JSON.stringify([event])], client,
      );
      return rowToKnowledgeGap(updated);
    });
  }

  async listKnowledgeGaps(limit = 100, status: KnowledgeGapFilter = "all"): Promise<KnowledgeGap[]> {
    const rows = await this.query(
      `SELECT * FROM knowledge_gaps
       WHERE organization_id = $1 AND ($3 = 'all' OR status = $3)
       ORDER BY times_asked DESC, last_asked_at DESC LIMIT $2`,
      [this.organizationId, Math.max(1, Math.min(limit, 500)), status],
    );
    return rows.map(rowToKnowledgeGap);
  }

  async listMemory(limit = 50): Promise<MemoryObject[]> {
    const rows = await this.query(
      `SELECT * FROM memory_objects
       WHERE organization_id = $1 AND NOT (metadata_json ? 'deleted_at')
       ORDER BY updated_at DESC LIMIT $2`,
      [this.organizationId, Math.max(1, Math.min(limit, 200))],
    );
    return this.memoryRows(rows);
  }

  async listAllMemory(kinds?: MemoryKind[]): Promise<MemoryObject[]> {
    const rows = kinds && kinds.length > 0
      ? await this.query(
          `SELECT * FROM memory_objects
           WHERE organization_id = $1 AND NOT (metadata_json ? 'deleted_at')
             AND kind = ANY($2::text[])
           ORDER BY updated_at DESC`,
          [this.organizationId, kinds],
        )
      : await this.query(
          `SELECT * FROM memory_objects
           WHERE organization_id = $1 AND NOT (metadata_json ? 'deleted_at')
           ORDER BY updated_at DESC`,
          [this.organizationId],
        );
    return this.memoryRows(rows);
  }

  async listRestrictedMemory(): Promise<MemoryObject[]> {
    const rows = await this.query(
      `SELECT * FROM memory_objects
       WHERE organization_id = $1 AND metadata_json->>'sensitivity' = 'restricted'`,
      [this.organizationId],
    );
    return this.memoryRows(rows);
  }

  async getEvidenceOwners(evidenceId: string): Promise<MemoryObject[]> {
    const rows = await this.query(
      `SELECT DISTINCT memory_objects.* FROM memory_objects
       LEFT JOIN memory_aliases
         ON memory_aliases.organization_id = memory_objects.organization_id
        AND memory_aliases.memory_id = memory_objects.id
       WHERE memory_objects.organization_id = $1
         AND (memory_objects.evidence_ids_json ? $2 OR memory_aliases.evidence_ids_json ? $2)`,
      [this.organizationId, evidenceId],
    );
    return this.memoryRows(rows);
  }

  async listIsmsControls(
    includeArchived = false,
    database: Queryable = this.pool,
  ): Promise<IsmsControl[]> {
    const rows = await this.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM isms_controls
       WHERE organization_id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}
       ORDER BY updated_at DESC`,
      [this.organizationId],
      database,
    );
    return rows.map((row) => ismsControlSchema.parse(parseJson(row.payload_json)));
  }

  async searchIsmsControls(query: string, limit = 10): Promise<IsmsControl[]> {
    const normalized = normalizedSearchText(query);
    const terms = queryTerms(query).slice(0, 16);
    if (terms.length === 0) return [];
    return (await this.listIsmsControls())
      .map((control) => {
        const heading = normalizedSearchText(`${control.reference} ${control.title}`);
        const body = normalizedSearchText([
          control.framework, control.framework_version, control.objective, control.owner,
          control.applicability_rationale,
          ...control.evidence_references.flatMap((reference) => [reference.label, reference.locator]),
        ].join(" "));
        const score = terms.reduce(
          (total, term) => total + (heading.includes(term) ? 4 : 0) + (body.includes(term) ? 1 : 0),
          heading.includes(normalized) ? 8 : 0,
        );
        return { control, score };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map((result) => result.control);
  }

  async getIsmsControl(
    id: string,
    database: Queryable = this.pool,
  ): Promise<IsmsControl | undefined> {
    const [row] = await this.query<{ payload_json: unknown }>(
      "SELECT payload_json FROM isms_controls WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return row ? ismsControlSchema.parse(parseJson(row.payload_json)) : undefined;
  }

  async listIsmsControlRevisions(id: string): Promise<IsmsControlRevision[]> {
    const rows = await this.query<{
      control_id: string;
      version: number;
      payload_json: unknown;
      actor: string;
      changed_at: string;
    }>(
      `SELECT control_id, version, payload_json, actor, changed_at
       FROM isms_control_revisions
       WHERE organization_id = $1 AND control_id = $2
       ORDER BY version DESC`,
      [this.organizationId, id],
    );
    return rows.map((row) => ismsControlRevisionSchema.parse({
      control_id: row.control_id,
      version: row.version,
      control: parseJson(row.payload_json),
      actor: row.actor,
      changed_at: row.changed_at,
    }));
  }

  async saveIsmsControl(
    input: IsmsControlInput,
    actor: string,
    id?: string,
    expectedVersion?: number,
  ): Promise<IsmsControl> {
    return this.transaction(async (client) => {
      const previous = id ? await this.getIsmsControl(id, client) : undefined;
      if (id && (!previous || previous.archived_at)) throw new NotFoundError("ISMS control was not found.");
      if (previous && previous.version !== expectedVersion) {
        throw new InputError("This control has changed. Reload it before saving.");
      }
      for (const memoryId of input.linked_memory_ids) {
        const memory = await this.getMemory(memoryId, client);
        if (!memory || memory.metadata.deleted_at) {
          throw new InputError(`Linked model object ${memoryId} was not found.`);
        }
      }
      const referenceKey = `${input.framework}\u001f${input.framework_version}\u001f${input.reference}`
        .toLocaleLowerCase();
      const [conflicting] = await this.query<{ id: string }>(
        `SELECT id FROM isms_controls
         WHERE organization_id = $1 AND reference_key = $2 AND archived_at IS NULL`,
        [this.organizationId, referenceKey],
        client,
      );
      if (conflicting && conflicting.id !== id) {
        throw new InputError("A control with this framework, version, and reference already exists.");
      }
      const timestamp = now();
      const control = ismsControlSchema.parse({
        ...input,
        id: previous?.id ?? `isms_${randomUUID()}`,
        governance_state: "draft",
        version: (previous?.version ?? 0) + 1,
        actor,
        created_at: previous?.created_at ?? timestamp,
        updated_at: timestamp,
        archived_at: null,
      });
      await this.query(
        `INSERT INTO isms_controls (
          organization_id, id, reference_key, payload_json, version, updated_at, archived_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, NULL)
        ON CONFLICT(organization_id, id) DO UPDATE SET
          reference_key = EXCLUDED.reference_key, payload_json = EXCLUDED.payload_json,
          version = EXCLUDED.version, updated_at = EXCLUDED.updated_at, archived_at = NULL`,
        [this.organizationId, control.id, referenceKey, JSON.stringify(control), control.version, timestamp],
        client,
      );
      await this.recordIsmsRevision(control, client);
      return control;
    });
  }

  async changeIsmsControlState(
    id: string,
    state: "approved" | "archived",
    actor: string,
    expectedVersion: number,
  ): Promise<IsmsControl> {
    return this.transaction(async (client) => {
      const previous = await this.getIsmsControl(id, client);
      if (!previous || previous.archived_at) throw new NotFoundError("ISMS control was not found.");
      if (previous.version !== expectedVersion) {
        throw new InputError("This control has changed. Reload it before continuing.");
      }
      if (state === "approved" && previous.governance_state !== "draft") {
        throw new InputError("Only draft controls can be approved.");
      }
      if (state === "approved" && previous.applicability === "undecided") {
        throw new InputError("Decide applicability before approving this control.");
      }
      const timestamp = now();
      const control = ismsControlSchema.parse({
        ...previous,
        governance_state: state,
        version: previous.version + 1,
        actor,
        updated_at: timestamp,
        archived_at: state === "archived" ? timestamp : null,
      });
      await this.query(
        `UPDATE isms_controls SET payload_json = $3::jsonb, version = $4,
          updated_at = $5, archived_at = $6
         WHERE organization_id = $1 AND id = $2`,
        [this.organizationId, id, JSON.stringify(control), control.version, timestamp, control.archived_at],
        client,
      );
      await this.recordIsmsRevision(control, client);
      return control;
    });
  }

  private async recordIsmsRevision(control: IsmsControl, database: Queryable): Promise<void> {
    await this.query(
      `INSERT INTO isms_control_revisions (
        organization_id, control_id, version, payload_json, actor, changed_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [this.organizationId, control.id, control.version, JSON.stringify(control),
        control.actor, control.updated_at],
      database,
    );
  }

  async searchMemory(query: string, limit = 8, kinds?: MemoryKind[]): Promise<MemoryObject[]> {
    const normalized = normalizedSearchText(query);
    const questionKey = normalizedQuestionKey(query);
    const investigationRows = await this.query<{
      question: string;
      learned_memory_ids_json: unknown;
    }>(
      `SELECT question, learned_memory_ids_json FROM investigations
       WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [this.organizationId],
    );
    const learnedFromExactQuestion = new Set(
      investigationRows
        .filter((row) => normalizedQuestionKey(row.question) === questionKey)
        .flatMap((row) => parseStrings(row.learned_memory_ids_json)),
    );
    const keywords = queryKeywords(query);
    const tokens = queryTerms(query).slice(0, 20);
    if (tokens.length === 0) return [];
    const candidates = await this.listAllMemory(kinds);
    return candidates
      .map((item) => {
        const title = normalizedSearchText(item.title);
        const originQuestion = typeof item.metadata.origin_question === "string"
          ? item.metadata.origin_question : "";
        const exactQuestionMatch = learnedFromExactQuestion.has(item.id) ||
          normalizedQuestionKey(item.title) === questionKey ||
          normalizedQuestionKey(originQuestion) === questionKey;
        const statement = normalizedSearchText(`${item.statement} ${item.subjects.join(" ")}`);
        const verifiedAliases = (item.aliases ?? []).filter((alias) => alias.status === "verified");
        const proposedAliases = (item.aliases ?? []).filter((alias) => alias.status === "proposed");
        const verifiedAliasText = normalizedSearchText(verifiedAliases.map((alias) => alias.name).join(" "));
        const proposedAliasText = normalizedSearchText(proposedAliases.map((alias) => alias.name).join(" "));
        const metadata = normalizedSearchText(JSON.stringify(item.metadata)).slice(0, 16_000);
        const haystack = `${item.kind} ${title} ${statement} ${verifiedAliasText} ${proposedAliasText} ${metadata}`;
        const requiredKeywordMatches = keywords.length >= 4 ? 3 : keywords.length >= 3 ? 2 : 1;
        const keywordMatches = keywords.filter((keyword) => statement.includes(keyword)).length;
        const aliasKeywordMatches = keywords.filter((keyword) =>
          verifiedAliasText.includes(keyword) || proposedAliasText.includes(keyword)).length;
        const metadataKeywordMatches = keywords.filter((keyword) => metadata.includes(keyword)).length;
        const score = tokens.reduce(
          (total, token) => total + (title.includes(token) ? 4 : 0) +
            (verifiedAliasText.includes(token) ? 3 : 0) +
            (proposedAliasText.includes(token) ? 1 : 0) +
            (haystack.includes(token) ? 1 : 0),
          haystack.includes(normalized) ? 8 : 0,
        );
        return {
          item,
          score: score + (exactQuestionMatch ? 20 : 0),
          relevant: exactQuestionMatch || keywordMatches >= requiredKeywordMatches ||
            aliasKeywordMatches >= Math.min(requiredKeywordMatches, keywords.length) ||
            metadataKeywordMatches >= Math.min(2, keywords.length),
        };
      })
      .filter(({ score, relevant }) => relevant && score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 50)))
      .map(({ item }) => item);
  }

  async link(
    fromId: string,
    predicate: string,
    toId: string,
    metadata: JsonRecord = {},
    database: Queryable = this.pool,
  ): Promise<MemoryRelationship> {
    const id = stableId("rel", `${fromId}:${predicate}:${toId}`);
    await this.query(
      `INSERT INTO relationships (
        organization_id, id, from_id, predicate, to_id, created_at, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT(organization_id, from_id, predicate, to_id) DO UPDATE SET
        metadata_json = EXCLUDED.metadata_json`,
      [this.organizationId, id, fromId, predicate, toId, now(), JSON.stringify(metadata)],
      database,
    );
    const [row] = await this.query(
      "SELECT * FROM relationships WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
      database,
    );
    return rowToRelationship(row!);
  }

  async listRelationships(
    memoryId?: string,
    database: Queryable = this.pool,
  ): Promise<MemoryRelationship[]> {
    const rows = memoryId
      ? await this.query(
          `SELECT * FROM relationships
           WHERE organization_id = $1 AND (from_id = $2 OR to_id = $2)
           ORDER BY created_at DESC`,
          [this.organizationId, memoryId],
          database,
        )
      : await this.query(
          "SELECT * FROM relationships WHERE organization_id = $1 ORDER BY created_at DESC",
          [this.organizationId],
          database,
        );
    return rows.map(rowToRelationship);
  }

  async saveInvestigation(input: {
    conversationId?: string;
    question: string;
    answer: string;
    analysis: unknown;
    recalledMemoryIds: string[];
    learnedMemoryIds: string[];
  }): Promise<{ id: string; createdAt: string }> {
    const id = `inv_${randomUUID()}`;
    const createdAt = now();
    await this.transaction(async (client) => {
      await this.query(
        `INSERT INTO investigations (
          organization_id, id, question, answer, analysis_json, recalled_memory_ids_json,
          learned_memory_ids_json, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)`,
        [this.organizationId, id, input.question, input.answer, JSON.stringify(input.analysis),
          JSON.stringify(input.recalledMemoryIds), JSON.stringify(input.learnedMemoryIds), createdAt],
        client,
      );
      if (input.conversationId) {
        await this.query(
          `INSERT INTO conversation_turns (
            organization_id, id, conversation_id, investigation_id, created_at
          ) VALUES ($1, $2, $3, $4, $5)`,
          [this.organizationId, `turn_${randomUUID()}`, input.conversationId, id, createdAt],
          client,
        );
        await this.query(
          "UPDATE conversations SET updated_at = $3 WHERE organization_id = $1 AND id = $2",
          [this.organizationId, input.conversationId, createdAt],
          client,
        );
      }
    });
    return { id, createdAt };
  }

  async getInvestigation(id: string): Promise<StoredInvestigation | null> {
    const [row] = await this.query(
      "SELECT * FROM investigations WHERE organization_id = $1 AND id = $2",
      [this.organizationId, id],
    );
    if (!row) return null;
    return {
      id: String(row.id),
      question: String(row.question),
      answer: String(row.answer),
      analysis: parseJson(row.analysis_json),
      recalledMemoryIds: parseStrings(row.recalled_memory_ids_json),
      learnedMemoryIds: parseStrings(row.learned_memory_ids_json),
      createdAt: String(row.created_at),
    };
  }

  async createConversation(input: {
    title: string;
    repositoryCommitSha: string;
    createdBy: string;
  }): Promise<StoredConversation> {
    const id = `conv_${randomUUID()}`;
    const timestamp = now();
    await this.query(
      `INSERT INTO conversations (
        organization_id, id, title, repository_commit_sha, created_at, updated_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [this.organizationId, id, input.title.trim(), input.repositoryCommitSha, timestamp, input.createdBy],
    );
    return (await this.getConversation(id, input.createdBy))!;
  }

  // Only the person who started a conversation can read or continue it.
  async getConversation(id: string, createdBy: string): Promise<StoredConversation | null> {
    const [row] = await this.query(
      `SELECT c.*, COUNT(ct.id)::text AS turn_count
       FROM conversations c
       LEFT JOIN conversation_turns ct
         ON ct.organization_id = c.organization_id AND ct.conversation_id = c.id
       WHERE c.organization_id = $1 AND c.id = $2 AND c.created_by = $3
       GROUP BY c.organization_id, c.id`,
      [this.organizationId, id, createdBy],
    );
    if (!row) return null;
    const turns = await this.query<{ investigation_id: string }>(
      `SELECT investigation_id FROM conversation_turns
       WHERE organization_id = $1 AND conversation_id = $2
       ORDER BY created_at ASC, id ASC`,
      [this.organizationId, id],
    );
    return {
      id: String(row.id),
      title: String(row.title),
      repository_commit_sha: String(row.repository_commit_sha),
      turn_count: Number(row.turn_count),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      investigationIds: turns.map((turn) => turn.investigation_id),
    };
  }

  async listConversations(createdBy: string, limit = 20): Promise<ConversationSummary[]> {
    const rows = await this.query(
      `SELECT c.*, COUNT(ct.id)::text AS turn_count
       FROM conversations c
       LEFT JOIN conversation_turns ct
         ON ct.organization_id = c.organization_id AND ct.conversation_id = c.id
       WHERE c.organization_id = $1 AND c.created_by = $3
       GROUP BY c.organization_id, c.id
       ORDER BY c.updated_at DESC LIMIT $2`,
      [this.organizationId, Math.max(1, Math.min(limit, 50)), createdBy],
    );
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      repository_commit_sha: String(row.repository_commit_sha),
      turn_count: Number(row.turn_count),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  }

  async counts(): Promise<{ memory: number; sources: number; candidates: number }> {
    const [row] = await this.query<{ memory: string; sources: string; candidates: string }>(
      `SELECT
        (SELECT COUNT(*) FROM memory_objects
         WHERE organization_id = $1 AND NOT (metadata_json ? 'deleted_at'))::text AS memory,
        (SELECT COUNT(*) FROM sources
         WHERE organization_id = $1 AND NOT (metadata_json ? 'removed_at'))::text AS sources,
        (SELECT COUNT(*) FROM memory_objects
         WHERE organization_id = $1 AND state = 'candidate'
           AND NOT (metadata_json ? 'deleted_at'))::text AS candidates`,
      [this.organizationId],
    );
    return {
      memory: Number(row.memory),
      sources: Number(row.sources),
      candidates: Number(row.candidates),
    };
  }
}
