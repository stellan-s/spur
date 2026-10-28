import { z } from "zod";

import { modeledEvidenceProblem } from "./modeling-evidence-policy";
import { analysisResultSchema } from "./types";

export const sourceKindSchema = z.enum([
  "repository",
  "mcp_server",
  "document",
]);

export const sourceStatusSchema = z.enum([
  "connected",
  "configured",
  "disabled",
  "error",
]);

export const sourceSchema = z.object({
  id: z.string(),
  kind: sourceKindSchema,
  name: z.string(),
  locator: z.string(),
  status: sourceStatusSchema,
  enabled: z.boolean(),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const memoryKindSchema = z.enum([
  "application",
  "system",
  "integration",
  "information",
  "entity",
  "capability",
  "process",
  "control",
  "decision",
  "rule",
  "observation",
]);

export const modeledMemoryKindSchema = z.enum([
  "system",
  "integration",
  "information",
  "entity",
  "capability",
  "process",
  "control",
  "rule",
  "observation",
]);

export const memoryStateSchema = z.enum([
  "candidate",
  "accepted",
  "disputed",
  "stale",
  "deleted",
]);

export const memoryAuthoritySchema = z.enum([
  "system",
  "document",
  "person",
  "ai_inference",
]);

export const memoryRelationshipSchema = z.object({
  id: z.string(),
  from_id: z.string(),
  predicate: z.string(),
  to_id: z.string(),
  created_at: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const memoryObjectSchema = z.object({
  id: z.string(),
  kind: memoryKindSchema,
  title: z.string(),
  statement: z.string(),
  state: memoryStateSchema,
  authority: memoryAuthoritySchema,
  confidence: z.number().min(0).max(1),
  subjects: z.array(z.string()),
  evidence_ids: z.array(z.string()),
  source_ids: z.array(z.string()),
  source_version: z.string().nullable(),
  actor: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const storedEvidenceSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_version: z.string(),
  path: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  excerpt: z.string(),
  kind: z.string(),
  created_at: z.string(),
});

export const sourceAnalysisRunStatusSchema = z.enum(["active", "completed"]);

export const sourceAnalysisRunSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_version: z.string(),
  idempotency_key: z.string(),
  client_name: z.string(),
  client_version: z.string().nullable(),
  model: z.string().nullable(),
  status: sourceAnalysisRunStatusSchema,
  object_count: z.number().int().nonnegative(),
  relationship_count: z.number().int().nonnegative(),
  evidence_count: z.number().int().nonnegative(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export const beginSourceAnalysisInputSchema = z.object({
  commit_sha: z.string().regex(/^[a-f0-9]{40,64}$/i),
  repository: z.string().trim().min(1).max(200).optional(),
  idempotency_key: z.string().trim().min(8).max(200),
  client_name: z.string().trim().min(2).max(120),
  client_version: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
});

export const modeledEvidenceInputSchema = z.object({
  kind: z.enum(["code", "test"]),
  path: z.string().trim().min(1).max(1_000),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  excerpt: z.string().min(1).max(24_000),
}).superRefine((input, context) => {
  const problem = modeledEvidenceProblem(input);
  if (problem) context.addIssue({ code: "custom", message: problem });
});

export const informationClassificationSchema = z.string().trim().min(1).max(80);

export const entityAttributeSchema = z.object({
  name: z.string().trim().min(1).max(160),
  data_type: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1_000).optional(),
  required: z.boolean().default(false),
  identifier: z.boolean().default(false),
  unique: z.boolean().default(false),
  information_classification: informationClassificationSchema.optional(),
});

export const dataLocationRoleSchema = z.enum([
  "system_of_record",
  "copy",
  "legacy",
  "history",
  "reference",
  "derived",
]);

export const dataLocationSchema = z.object({
  system: z.string().trim().min(1).max(160),
  storage_type: z.string().trim().min(1).max(80),
  locator: z.string().trim().min(1).max(1_000),
  environment: z.string().trim().min(1).max(80).optional(),
  role: dataLocationRoleSchema.optional(),
});

// New and edited entities must state each location's role in the role field,
// not as a prefix of storage_type.
export const modeledDataLocationSchema = dataLocationSchema.extend({
  storage_type: z.string().trim().min(1).max(80).refine(
    (value) => !dataLocationRoleSchema.options.some((role) => value.toLowerCase().startsWith(`${role}:`)),
    "Put the location's role in role, not in storage_type.",
  ),
  role: dataLocationRoleSchema,
});

export const entityDefinitionSchema = z.object({
  technical_name: z.string().trim().min(1).max(240).optional(),
  information_classification: informationClassificationSchema.optional(),
  attributes: z.array(entityAttributeSchema).max(100).default([]),
  data_locations: z.array(dataLocationSchema).max(30).default([]),
});

export const modeledEntityDefinitionSchema = entityDefinitionSchema.extend({
  data_locations: z.array(modeledDataLocationSchema).max(30).default([]),
});

export const relationshipCardinalitySchema = z.enum([
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
]);

export const proposedMemoryObjectSchema = z.object({
  external_id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/),
  kind: modeledMemoryKindSchema,
  title: z.string().trim().min(3).max(160),
  statement: z.string().trim().min(5).max(4_000),
  confidence: z.number().min(0).max(1).default(0.8),
  sensitivity: z.literal("restricted").optional(),
  subjects: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  evidence: z.array(modeledEvidenceInputSchema).min(1).max(12),
  entity_definition: modeledEntityDefinitionSchema.optional(),
}).superRefine((input, context) => {
  if (input.kind === "entity" && !input.entity_definition) {
    context.addIssue({
      code: "custom",
      path: ["entity_definition"],
      message: "Entity objects require an entity definition.",
    });
  }
  if (input.kind !== "entity" && input.entity_definition) {
    context.addIssue({
      code: "custom",
      path: ["entity_definition"],
      message: "Entity definitions can only be attached to entity objects.",
    });
  }
});

export const proposeMemoryObjectsInputSchema = z.object({
  run_id: z.string().min(1),
  objects: z.array(proposedMemoryObjectSchema).min(1).max(50),
});

export const addEvidenceInputSchema = z.object({
  run_id: z.string().min(1),
  memory_id: z.string().regex(/^mem_[a-zA-Z0-9_-]+$/),
  evidence: z.array(modeledEvidenceInputSchema).min(1).max(12),
});

export const proposedRelationshipSchema = z.object({
  from_external_id: z.string().trim().min(1).max(160),
  predicate: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
  to_external_id: z.string().trim().min(1).max(160),
  cardinality: relationshipCardinalitySchema.optional(),
  source_attribute: z.string().trim().min(1).max(160).optional(),
  target_attribute: z.string().trim().min(1).max(160).optional(),
});

export const proposeRelationshipsInputSchema = z.object({
  run_id: z.string().min(1),
  relationships: z.array(proposedRelationshipSchema).min(1).max(100),
});

export const workspaceSchema = z.object({
  permissions: z.array(z.string()).optional(),
  features: z.object({
    ask: z.boolean(),
    code_search: z.enum(["off", "ask", "on"]),
    model_provider: z.enum(["none", "anthropic", "openai"]),
    modelling_writes: z.boolean(),
    isms: z.boolean(),
    wiki: z.boolean(),
    remote_mcp: z.boolean(),
    knowledge_gaps: z.boolean(),
  }).optional(),
  organization: z.object({
    slug: z.string(),
    name: z.string(),
  }),
  repository: z.object({
    ready: z.boolean(),
    name: z.string(),
    commit_sha: z.string(),
  }),
  provider: z.string(),
  synthesis_provider: z.string(),
  actor: z.string(),
  mcp: z.object({
    ready: z.boolean(),
    transport: z.literal("stdio"),
    server_name: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    repository_root: z.string(),
  }),
  sources: z.array(sourceSchema),
  memory: z.array(memoryObjectSchema),
  relationships: z.array(memoryRelationshipSchema),
  counts: z.object({
    memory: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
  }),
});

export const investigationResultSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  question: z.string(),
  answer: z.string(),
  analysis: analysisResultSchema,
  recalled_memory: z.array(memoryObjectSchema),
  learned_memory: z.array(memoryObjectSchema),
  created_at: z.string(),
});

export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  repository_commit_sha: z.string(),
  turn_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const conversationSchema = conversationSummarySchema.extend({
  turns: z.array(investigationResultSchema),
});

export const recordDecisionInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  statement: z.string().trim().min(5).max(2_000),
  rationale: z.string().trim().max(2_000).optional().default(""),
  owner: z.string().trim().min(2).max(120),
  related_to: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});

export const editMemoryBaseSchema = z.object({
  action: z.literal("edit"),
  kind: memoryKindSchema,
  title: z.string().trim().min(3).max(160),
  statement: z.string().trim().min(5).max(4_000),
  subjects: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  entity_definition: modeledEntityDefinitionSchema.optional(),
  // Business owner decides on the object; steward maintains it. Omitted keeps the current value.
  owner: z.string().trim().min(2).max(120).optional(),
  steward: z.string().trim().min(2).max(120).optional(),
  // One-way: an edit can restrict an object but never lift the restriction.
  sensitivity: z.literal("restricted").optional(),
});

export const editMemoryInputSchema = editMemoryBaseSchema.superRefine((input, context) => {
  if (input.kind === "entity" && !input.entity_definition) {
    context.addIssue({
      code: "custom",
      path: ["entity_definition"],
      message: "Entity objects require an entity definition.",
    });
  }
  if (input.kind !== "entity" && input.entity_definition) {
    context.addIssue({
      code: "custom",
      path: ["entity_definition"],
      message: "Entity definitions can only be attached to entity objects.",
    });
  }
});

export const promoteMemoryInputSchema = z.object({
  action: z.literal("promote"),
});

export const archiveMemoryInputSchema = z.object({
  action: z.literal("archive"),
  confirmation: z.string().min(1),
});

export const mergeMemoryInputSchema = z.object({
  source_id: z.string().regex(/^mem_[a-zA-Z0-9_-]+$/),
  target_id: z.string().regex(/^mem_[a-zA-Z0-9_-]+$/),
  confirmation: z.string().min(1),
});

export const manageMemoryInputSchema = z.discriminatedUnion("action", [
  editMemoryInputSchema,
  promoteMemoryInputSchema,
  archiveMemoryInputSchema,
]);

export const registerSourceInputSchema = z.object({
  kind: z.enum(["repository", "mcp_server", "document"]),
  name: z.string().trim().min(2).max(120),
  locator: z.string().trim().url().max(2_000),
  authentication: z.enum(["none", "bearer_env"]).default("none"),
  credential_env: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]*$/, "Credential environment variable must use uppercase letters, numbers, and underscores.")
    .optional(),
}).superRefine((input, context) => {
  if (input.authentication === "bearer_env" && !input.credential_env) {
    context.addIssue({
      code: "custom",
      path: ["credential_env"],
      message: "A credential environment variable is required for bearer authentication.",
    });
  }
});

export type Source = z.infer<typeof sourceSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type MemoryObject = z.infer<typeof memoryObjectSchema>;
export type MemoryKind = z.infer<typeof memoryKindSchema>;
export type ModeledMemoryKind = z.infer<typeof modeledMemoryKindSchema>;
export type MemoryRelationship = z.infer<typeof memoryRelationshipSchema>;
export type StoredEvidence = z.infer<typeof storedEvidenceSchema>;
export type SourceAnalysisRun = z.infer<typeof sourceAnalysisRunSchema>;
export type BeginSourceAnalysisInput = z.infer<typeof beginSourceAnalysisInputSchema>;
export type ProposedMemoryObject = z.infer<typeof proposedMemoryObjectSchema>;
export type EntityDefinition = z.infer<typeof entityDefinitionSchema>;
export type EntityAttribute = z.infer<typeof entityAttributeSchema>;
export type DataLocation = z.infer<typeof dataLocationSchema>;
export type RelationshipCardinality = z.infer<typeof relationshipCardinalitySchema>;
export type ProposeMemoryObjectsInput = z.infer<typeof proposeMemoryObjectsInputSchema>;
export type AddEvidenceInput = z.infer<typeof addEvidenceInputSchema>;
export type ProposeRelationshipsInput = z.infer<typeof proposeRelationshipsInputSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type InvestigationResult = z.infer<typeof investigationResultSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type RecordDecisionInput = z.infer<typeof recordDecisionInputSchema>;
export type EditMemoryInput = z.infer<typeof editMemoryInputSchema>;
export type ManageMemoryInput = z.infer<typeof manageMemoryInputSchema>;
export type RegisterSourceInput = z.infer<typeof registerSourceInputSchema>;
