import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { BETA_NOTICE_ENGLISH } from "../core/beta-notice";

import { AccessStore, localPrincipal, type Principal } from "../core/access-store";
import { resolveOrganizationConfig, tenancyMode, type SpurConfig } from "../core/config";
import { ConfigurationError, InputError } from "../core/errors";
import {
  knowledgeGapFilterSchema,
  knowledgeGapSchema,
  reopenKnowledgeGapInputSchema,
  resolveKnowledgeGapInputSchema,
} from "../core/knowledge-gap-types";
import {
  applyFeatures,
  featureEnabled,
  features,
  type OrganizationFeatures,
} from "../core/features";
import {
  ismsControlInputSchema,
  ismsControlRevisionSchema,
  ismsControlSchema,
} from "../core/isms-types";
import {
  addEvidenceInputSchema,
  beginSourceAnalysisInputSchema,
  editMemoryBaseSchema,
  mergeMemoryInputSchema,
  memoryKindSchema,
  memoryAliasSchema,
  memoryObjectSchema,
  memoryRelationshipSchema,
  modeledMemoryKindSchema,
  proposeMemoryAliasInputSchema,
  proposeMemoryObjectsInputSchema,
  proposeRelationshipsInputSchema,
  recordDecisionInputSchema,
  reviewMemoryAliasInputSchema,
  sourceAnalysisRunSchema,
  storedEvidenceSchema,
} from "../core/memory-types";
import { MCP_TOOL_FEATURES, MCP_TOOL_PERMISSIONS, type McpToolName } from "../core/permissions";
import {
  MODELED_EVIDENCE_MAX_BYTES,
  MODELED_EVIDENCE_MAX_LINES,
} from "../core/modeling-evidence-policy";
import {
  BROAD_QUALITY_ASSESSMENT_MESSAGE,
  requestsBroadQualityAssessment,
} from "../core/question-scope";
import { RELATIONSHIP_PREDICATES } from "../core/relationship-vocabulary";
import { createSpurService, type SpurService } from "../core/spur-service";
import {
  containsSecurityIssue,
  isDescriptiveKind,
  isSecurityIssueMemory,
  requestsSecurityIssues,
  SECURITY_WITHHELD_MESSAGE,
} from "../core/security-disclosure";
import { analysisResultSchema } from "../core/types";
import { logEvent, logUnexpectedError } from "../core/logger";
import { productDocumentInputSchema } from "../core/product-document";

const SPUR_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MCP_BETA_NOTICE = BETA_NOTICE_ENGLISH;

const repositoryEvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(["code", "test", "approved_document", "verification_record", "unapproved_context"]),
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: z.string(),
  score: z.number(),
});

const searchedRepositorySchema = z.object({
  name: z.string(),
  commit_sha: z.string(),
  analyzed_files: z.number().int().nonnegative(),
});

const codeEvidenceSchema = repositoryEvidenceSchema.extend({
  repo: z.string(),
  commit_sha: z.string(),
});

const repositorySearchResultSchema = z.object({
  repositories: z.array(searchedRepositorySchema),
  candidates: z.array(codeEvidenceSchema),
});

const hostInvestigationSchema = z.object({
  question: z.string(),
  code_search: z.object({
    mode: z.enum(["off", "ask", "on"]),
    searched: z.boolean(),
    repositories: z.array(searchedRepositorySchema),
  }),
  recalled_memory: z.array(memoryObjectSchema),
  related_memory: z.array(memoryObjectSchema),
  relationships: z.array(memoryRelationshipSchema),
  memory_evidence: z.array(storedEvidenceSchema),
  repository_evidence: z.array(codeEvidenceSchema),
  packet_limits: z.object({
    recalled_memory: z.number().int().positive(),
    related_memory: z.number().int().positive(),
    relationships: z.number().int().positive(),
    memory_evidence: z.number().int().positive(),
    repository_evidence: z.number().int().positive(),
    lines_per_excerpt: z.number().int().positive(),
  }),
  answering_instructions: z.array(z.string()),
});

const editMemoryToolInputSchema = editMemoryBaseSchema
  .omit({ action: true })
  .extend({ id: z.string().min(1) });

const confirmedMemoryMutationSchema = z.object({
  id: z.string().min(1),
  confirmation: z
    .string()
    .min(1)
    .describe("Repeat the exact memory object ID to confirm this governance action."),
});

function requireMatchingConfirmation(id: string, confirmation: string): void {
  if (confirmation !== id) {
    throw new InputError("Confirmation must match the memory object ID.");
  }
}

function requireNoSecurityFinding(value: unknown, options: { descriptive?: boolean } = {}): void {
  if (containsSecurityIssue(JSON.stringify(value), options)) {
    throw new InputError(SECURITY_WITHHELD_MESSAGE);
  }
}

async function requireVisibleMemory(service: SpurService, id: string) {
  const item = await service.getMemory(id);
  if (item && isSecurityIssueMemory(item)) {
    throw new InputError(SECURITY_WITHHELD_MESSAGE);
  }
  return item;
}

function createSpurRunner(config: SpurConfig, principal: Principal) {
  return async function withSpur<T>(callback: (service: SpurService) => Promise<T> | T): Promise<T> {
    const service = createSpurService(config, principal);
    try {
      return await callback(service);
    } finally {
      await service.close();
    }
  };
}

export async function createSpurMcpServer(options: {
  principal?: Principal;
  features?: OrganizationFeatures;
  remote?: boolean;
} = {}) {
  if (tenancyMode() === "multi" && !options.principal) {
    throw new ConfigurationError("Multi-organisation MCP requires an authenticated remote connection bound to an organisation.");
  }
  const baseConfig = await resolveOrganizationConfig(options.principal?.organizationId, process.env, SPUR_PROJECT_ROOT);
  const featureValues = options.features ?? await features(
    baseConfig.organization.slug,
    process.env,
    SPUR_PROJECT_ROOT,
  );
  const config = applyFeatures(baseConfig, featureValues, { withoutProvider: !options.remote });
  const principal = options.principal ?? localPrincipal(config.organization.slug, config.actorName, {
    restrictedRead: config.localRestrictedRead,
  });
  const permissions = principal.permissions;
  const mcpEnabled = permissions.has("mcp.connect");
  const withSpur = createSpurRunner(config, principal);
  const productNameInstruction = config.applicationNaming
    ? ` Use ${config.applicationNaming.canonicalName} as the product name in your own responses. ${config.applicationNaming.aliases.join(", ")} are search aliases, not preferred names. Preserve exact code identifiers and source quotations.`
    : "";
  const server = new McpServer(
    { name: "spur", version: "0.2.0" },
    {
      instructions:
        "For questions about implementation or organizational memory, prefer investigate; search_memory only locates records. Do not answer broad quality or overall reliability questions about an application, API, codebase, architecture, or team, and do not assemble such an assessment from raw Spur tools. State Spur's boundary and ask for a specific, evidence-checkable question about behavior, rules, controls, dependencies, decisions, or recorded metrics. For questions about governed ISMS or audit controls, use search_isms_controls and get_isms_control first, then investigate only if implementation detail is needed. An ISMS control is distinct from a technical safeguard found in code; a model mapping or an approved control does not prove effectiveness. For answers based on Spur, write for a non-technical business reader in the user's language. Use a quiet **Spur** label and answer directly. By default, use one short paragraph of 2–4 sentences (roughly 80 words), or at most 3 short bullets when listing choices or steps. Include only conditions and caveats that materially change the answer; do not append unrelated findings. Keep code identifiers, API routes, HTTP status codes, file paths, line numbers, internal IDs, and commit hashes out of the main answer. Give a compact Sources line only when it helps attribution, and offer technical detail instead of adding it unasked. Explain code-derived behavior as observed behavior, not approved policy. If knowledge is only a candidate, say so in ordinary language. Aliases are retrieval vocabulary only; proposed or user-origin aliases are user-generated signals, not evidence for a capability, and rejected aliases must never be used. Never invent intent or certainty. Expand when the user asks for detail, a walkthrough, or a specific format; do not shorten an answer so much that it becomes misleading. End every user-facing answer based on Spur with this notice, translated to the user's language while preserving its meaning: Spur and the model are in BETA. Double-check the answer against the original sources." + productNameInstruction,
    },
  );
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, ...args: unknown[]) => {
    if (!(name in MCP_TOOL_PERMISSIONS)) {
      throw new Error(`MCP tool ${name} has no declared permission.`);
    }
    if (options.remote) {
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      if (typeof callback === "function") {
        args[callbackIndex] = async (...callbackArgs: unknown[]) => {
          const startedAt = Date.now();
          const toolInput = callbackArgs[0];
          const serialized = JSON.stringify(toolInput ?? {});
          const argumentSummary = {
            keys: toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)
              ? Object.keys(toolInput as Record<string, unknown>).sort()
              : [],
            byte_length: Buffer.byteLength(serialized),
          };
          const access = new AccessStore(config.databaseUrl);
          try {
            await access.consumeMcpRateLimit(
              principal.organizationId,
              principal.userId,
              config.mcpRateLimitPerMinute,
            );
            const result = await Reflect.apply(callback, server, callbackArgs);
            await access.recordMcpToolCall({
              organizationId: principal.organizationId,
              userId: principal.userId,
              tool: name,
              argumentSummary,
              result: "success",
              durationMs: Date.now() - startedAt,
            });
            return result;
          } catch (error) {
            await access.recordMcpToolCall({
              organizationId: principal.organizationId,
              userId: principal.userId,
              tool: name,
              argumentSummary,
              result: "error",
              durationMs: Date.now() - startedAt,
            });
            throw error;
          } finally {
            await access.close();
          }
        };
      }
    }
    const registered = Reflect.apply(originalRegisterTool, server, [name, ...args]) as {
      disable(): void;
    };
    const permission = MCP_TOOL_PERMISSIONS[name as McpToolName];
    const enabledByFeature = MCP_TOOL_FEATURES[name as McpToolName]
      .every((feature) => featureEnabled(featureValues, feature));
    if (!mcpEnabled || !permissions.has(permission) || !enabledByFeature) registered.disable();
    return registered;
  }) as typeof server.registerTool;
  const synthesisProvider = config.synthesisProvider;

  if (mcpEnabled && permissions.has("memory.read")) server.registerResource(
    "spur-workspace",
    "spur://workspace",
    {
      title: "Spur organizational memory",
      description: "Current sources, memory objects, relationships, and repository state.",
      mimeType: "application/json",
      cacheHint: { ttlMs: 0, cacheScope: "private" },
    },
    async (uri) => {
      const workspace = await withSpur((service) => service.workspace({ synchronizeRepository: false }));
      workspace.permissions = [...permissions].sort();
      workspace.features = featureValues;
      workspace.memory = workspace.memory.filter((item) => !isSecurityIssueMemory(item));
      const visibleIds = new Set(workspace.memory.map((item) => item.id));
      workspace.relationships = workspace.relationships.filter((relationship) =>
        visibleIds.has(relationship.from_id) && visibleIds.has(relationship.to_id),
      );
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(workspace, null, 2) }],
      };
    },
  );

  server.registerTool(
    "list_isms_controls",
    {
      title: "List ISMS controls",
      description: "Read the organization's governed information-security controls. These are distinct from safeguards observed in source code.",
      inputSchema: z.object({}),
      outputSchema: z.object({ controls: z.array(ismsControlSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const result = { controls: (await withSpur((service) => service.listIsmsControls()))
        .filter((control) => !containsSecurityIssue(JSON.stringify(control))) };
      return { content: [{ type: "text", text: JSON.stringify(result) }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "get_isms_control",
    {
      title: "Get an ISMS control",
      description: "Read a governed control, its mapped model objects, and its version history. Mappings are not effectiveness assessments.",
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({ control: ismsControlSchema, linked_memory: z.array(memoryObjectSchema), revisions: z.array(ismsControlRevisionSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const result = await withSpur((service) => service.getIsmsControlDetail(id));
      if (containsSecurityIssue(JSON.stringify(result.control))) {
        throw new InputError("This control is not available through MCP.");
      }
      result.linked_memory = result.linked_memory.filter((item) => !isSecurityIssueMemory(item));
      result.revisions = result.revisions.filter((revision) =>
        !containsSecurityIssue(JSON.stringify(revision.control)),
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "search_isms_controls",
    {
      title: "Search ISMS controls",
      description: "Find relevant governed controls by reference, title, objective, owner, or assessment-evidence reference. Prefer this to listing the whole catalog for a specific question.",
      inputSchema: z.object({ query: z.string().trim().min(2).max(500), limit: z.number().int().min(1).max(50).default(10) }),
      outputSchema: z.object({ controls: z.array(ismsControlSchema) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const result = { controls: requestsSecurityIssues(query) ? [] :
        (await withSpur((service) => service.searchIsmsControls(query, limit)))
          .filter((control) => !containsSecurityIssue(JSON.stringify(control))) };
      return { content: [{ type: "text", text: JSON.stringify(result) }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "propose_isms_control",
    {
      title: "Propose an ISMS control",
      description: "Create a draft governed control and optionally map it to existing Spur model-object IDs. Does not require a Spur model provider. Never claim the control is approved or effective. Use only when the user asks to record or model an ISMS control.",
      inputSchema: ismsControlInputSchema,
      outputSchema: ismsControlSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      requireNoSecurityFinding(input);
      const result = await withSpur((service) => service.saveIsmsControl(input));
      return { content: [{ type: "text", text: `Draft ISMS control ${result.reference} stored as version ${result.version}.` }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "edit_isms_control",
    {
      title: "Edit an ISMS control",
      description: "Save a new draft revision of an existing control. Requires the current version to prevent overwriting newer work. Use only when the user asks for a change; editing an approved control returns it to draft.",
      inputSchema: z.object({ id: z.string().min(1), expected_version: z.number().int().positive(), control: ismsControlInputSchema }),
      outputSchema: ismsControlSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, expected_version, control }) => {
      requireNoSecurityFinding(control);
      const result = await withSpur((service) => service.saveIsmsControl(control, id, expected_version));
      return { content: [{ type: "text", text: `Saved draft revision ${result.version} of ${result.reference}.` }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "approve_isms_control",
    {
      title: "Approve an ISMS control",
      description: "Mark a draft control as approved governance knowledge. Only use after the human user explicitly authorizes this specific approval. Repeat its exact ID as confirmation. Approval does not assert that implementation is effective.",
      inputSchema: z.object({ id: z.string().min(1), expected_version: z.number().int().positive(), confirmation: z.string().min(1) }),
      outputSchema: ismsControlSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, expected_version, confirmation }) => {
      requireMatchingConfirmation(id, confirmation);
      const result = await withSpur(async (service) => {
        requireNoSecurityFinding((await service.getIsmsControlDetail(id)).control);
        return service.approveIsmsControl(id, expected_version);
      });
      return { content: [{ type: "text", text: `Approved ISMS control ${result.reference}.` }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "archive_isms_control",
    {
      title: "Archive an ISMS control",
      description: "Remove a control from the active catalog while retaining its version history. Only use when the user explicitly requests it. Repeat the exact ID as confirmation.",
      inputSchema: z.object({ id: z.string().min(1), expected_version: z.number().int().positive(), confirmation: z.string().min(1) }),
      outputSchema: ismsControlSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, expected_version, confirmation }) => {
      const result = await withSpur(async (service) => {
        requireNoSecurityFinding((await service.getIsmsControlDetail(id)).control);
        return service.archiveIsmsControl(id, expected_version, confirmation);
      });
      return { content: [{ type: "text", text: `Archived ISMS control ${result.reference}.` }, { type: "text", text: MCP_BETA_NOTICE }], structuredContent: result };
    },
  );

  server.registerTool(
    "get_modeling_schema",
    {
      title: "Get the Spur modeling contract",
      description:
        "Describe the model-independent contract an MCP client uses to turn repository evidence into candidate organizational memory.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        object_kinds: z.array(modeledMemoryKindSchema),
        evidence_kinds: z.array(z.enum(["code", "test"])),
        object_state: z.literal("candidate"),
        authority: z.literal("ai_inference"),
        entity_modeling: z.object({
          entity_definition_fields: z.array(z.string()),
          attribute_fields: z.array(z.string()),
          location_fields: z.array(z.string()),
          relationship_cardinalities: z.array(z.string()),
        }),
        alias_modeling: z.object({
          object_field: z.literal("aliases"),
          stored_status: z.literal("proposed"),
          origin: z.literal("repository"),
          evidence_required: z.literal(true),
        }),
        relationship_predicates: z.record(z.string(), z.string()),
        layer_order: z.array(z.string()),
        lifecycle: z.array(z.string()),
        constraints: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const result = {
        object_kinds: modeledMemoryKindSchema.options,
        evidence_kinds: ["code", "test"] as const,
        object_state: "candidate" as const,
        authority: "ai_inference" as const,
        entity_modeling: {
          entity_definition_fields: [
            "technical_name",
            "information_classification",
            "attributes",
            "data_locations",
          ],
          attribute_fields: [
            "name",
            "data_type",
            "description",
            "required",
            "identifier",
            "unique",
            "information_classification",
          ],
          location_fields: ["system", "storage_type", "locator", "environment", "role"],
          relationship_cardinalities: [
            "one_to_one",
            "one_to_many",
            "many_to_one",
            "many_to_many",
          ],
        },
        alias_modeling: {
          object_field: "aliases" as const,
          stored_status: "proposed" as const,
          origin: "repository" as const,
          evidence_required: true as const,
        },
        relationship_predicates: { ...RELATIONSHIP_PREDICATES },
        layer_order: ["capability", "process", "rule", "control", "information", "entity", "system", "integration", "observation"],
        lifecycle: [
          "Search or inspect the connected repository.",
          "Begin a source analysis pinned to the returned commit SHA.",
          "Propose candidate memory objects and any repository-derived aliases with exact source excerpts.",
          "Propose relationships using run-local external IDs, or the IDs of memory stored by earlier runs.",
          "Complete the source analysis run.",
        ],
        constraints: [
          "Spur verifies every excerpt against the pinned Git commit before storing it.",
          `Modeled evidence is limited to ${MODELED_EVIDENCE_MAX_LINES} lines and ${MODELED_EVIDENCE_MAX_BYTES} bytes per excerpt. Cite the smallest exact range that supports the claim; data dumps, fixtures, snapshots, generated files, and dependencies are refused.`,
          "Entity objects require entity_definition; model fields as attributes and storage as data_locations.",
          "Relationships between two entities require cardinality and may identify their joining attributes.",
          "Use stored_in relationships to connect entities to modeled systems when the repository supports that claim.",
          "Set each data location's role in role: system_of_record, copy, legacy, history, reference, or derived. Name the system that holds the data, not the service that writes it. Give each entity one system of record; an API resource that serves stored data is a copy.",
          "Use only the predicates in relationship_predicates, in the stated direction. Entity to entity relationships use belongs_to (child to parent, many_to_one or one_to_one) or references, with cardinality.",
          "Titles are business names in sentence case. Keep code identifiers, table names and file paths out of titles; put them in technical_name, locators or the statement.",
          "Put an alternate business or product term in aliases only when a minimal exact excerpt supports that terminology. Aliases remain separately reviewable proposals and never replace the canonical title.",
          "Name processes as activities (\"Publishing a project setup draft\"). A statement of what always holds is a rule, not a process.",
          "Do not propose ISMS register controls (CTRL-nnn). Each register control has one mirror object that repeats the register wording. Model the technical safeguard and link the mirror to it with realised_by.",
          "When another repository confirms memory already in Spur, call add_evidence on that mem_ ID instead of proposing a duplicate.",
          "Set sensitivity: restricted for controls whose details would help an attacker, including request signing, token handling, rate limits, and session rules. Spur verifies the excerpt but masks the object and its evidence on reads.",
          "Agent-modeled objects remain candidates and cannot be accepted decisions.",
          "No Spur synthesis provider is required for this workflow.",
        ],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "begin_source_analysis",
    {
      title: "Begin a repository modeling run",
      description:
        "Open an idempotent analysis run at an exact commit. The commit may be any commit in the repository; the checkout is never switched. Pass `repository` (its folder name) to model one of SPUR_ADDITIONAL_REPOSITORIES instead of the primary repository; excerpts are then verified against that repository. This does not call a model inside Spur.",
      inputSchema: beginSourceAnalysisInputSchema,
      outputSchema: sourceAnalysisRunSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await withSpur((service) => service.beginSourceAnalysis(input));
      return {
        content: [{ type: "text", text: `Started source analysis ${result.id} at ${result.source_version}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "propose_memory_objects",
    {
      title: "Propose evidence-backed memory objects",
      description:
        "Store candidate systems, integrations, information, entities with attributes and data locations, capabilities, processes, controls, rules, or observations. Include alternate business or product terms as aliases only with their own exact evidence; aliases remain separately reviewable proposals and never replace the canonical title. Keep titles and statements in business language; code identifiers belong only in technical fields and minimal evidence. Set sensitivity to restricted for controls whose details would help an attacker, such as request signing, token issuing or revocation, rate limits, and session rules. Every short, exact code/test excerpt is verified at the run commit before any object is stored. Data, fixtures, snapshots, generated files, dependencies, and oversized excerpts are refused; restricted details are never returned by read tools.",
      inputSchema: proposeMemoryObjectsInputSchema,
      outputSchema: z.object({
        run: sourceAnalysisRunSchema,
        items: z.array(memoryObjectSchema),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      for (const object of input.objects) {
        requireNoSecurityFinding(
          { ...object, evidence: undefined },
          { descriptive: isDescriptiveKind(object.kind) },
        );
      }
      const result = await withSpur((service) => service.proposeMemoryObjects(input));
      return {
        content: [{ type: "text", text: `Stored ${result.items.length} verified candidate memory objects.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "propose_memory_alias",
    {
      title: "Suggest an alias for modeled knowledge",
      description:
        "Record a user's alternate name for one existing memory object. This creates a clearly user-generated proposal only: it does not edit the object, verify the alias, promote knowledge, or resolve a gap. Use only when the user explicitly offers or asks to save an alias.",
      inputSchema: proposeMemoryAliasInputSchema,
      outputSchema: memoryAliasSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      requireNoSecurityFinding(input);
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, input.memory_id);
        return service.proposeMemoryAlias(input, "mcp");
      });
      return {
        content: [{ type: "text", text: `Stored “${result.name}” as a user-generated alias proposal. It is not verified knowledge.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "review_memory_alias",
    {
      title: "Review a proposed memory alias",
      description:
        "Verify or reject one alias proposal without changing the canonical memory object. Requires reviewer permission and explicit human authorization; repeat the exact alias ID as confirmation. Verification preserves whether the alias originally came from a user or repository.",
      inputSchema: reviewMemoryAliasInputSchema,
      outputSchema: memoryAliasSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, input.memory_id);
        return service.reviewMemoryAlias(input);
      });
      return {
        content: [{ type: "text", text: `${result.status === "verified" ? "Verified" : "Rejected"} alias: ${result.name}. Its ${result.origin} origin remains recorded.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "propose_relationships",
    {
      title: "Propose modeled relationships",
      description:
        "Relate candidate objects using stable run-local external IDs. Entity-to-entity relationships require cardinality and may name joining attributes. An endpoint may also be the ID of non-archived memory stored earlier (mem_...), which links this run to earlier runs.",
      inputSchema: proposeRelationshipsInputSchema,
      outputSchema: z.object({
        run: sourceAnalysisRunSchema,
        relationships: z.array(memoryRelationshipSchema),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      requireNoSecurityFinding(input.relationships);
      const result = await withSpur((service) => service.proposeRelationships(input));
      return {
        content: [{ type: "text", text: `Stored ${result.relationships.length} modeled relationships.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "add_evidence",
    {
      title: "Add evidence to stored memory",
      description:
        "Attach minimal exact code/test excerpts from this run's repository to a memory object stored earlier (mem_...), keeping its existing evidence. Use it when another system confirms an entity, process, or rule already in Spur instead of proposing a duplicate. Data, fixtures, snapshots, generated files, dependencies, and oversized excerpts are refused. Every excerpt is verified at the run commit before anything is stored.",
      inputSchema: addEvidenceInputSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await withSpur(async (service) => {
        const memory = await requireVisibleMemory(service, input.memory_id);
        requireNoSecurityFinding(input.evidence, {
          descriptive: isDescriptiveKind(memory?.kind),
        });
        return service.addEvidence(input);
      });
      return {
        content: [{ type: "text", text: `Added evidence to ${result.kind}: ${result.title}. It now cites ${result.evidence_ids.length} excerpt(s).` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "complete_source_analysis",
    {
      title: "Complete a repository modeling run",
      description:
        "Seal a source analysis run after its candidate objects and relationships have been written.",
      inputSchema: z.object({ run_id: z.string().min(1) }),
      outputSchema: sourceAnalysisRunSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id }) => {
      const result = await withSpur((service) => service.completeSourceAnalysis(run_id));
      return {
        content: [{ type: "text", text: `Completed source analysis ${result.id}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  if (synthesisProvider !== "none") {
    server.registerTool(
      "explain_business_rule",
      {
        title: "Explain a business rule",
        description:
          "Use Spur's configured Anthropic or OpenAI provider to synthesize a business-rule explanation. MCP hosts without a Spur synthesis provider should use investigate instead.",
        inputSchema: z.object({
          question: z
            .string()
            .min(5)
            .max(500)
            .describe("A business-language question about the configured repository"),
        }),
        outputSchema: analysisResultSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ question }) => {
        const result = await withSpur(async (service) =>
          (await service.investigate(question)).analysis);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
          structuredContent: result,
        };
      },
    );
  }

  server.registerTool(
    "investigate",
    {
      title: "Answer a question",
      description:
        "Use this for a person's specific, evidence-checkable question about how the organization or its systems work. Do not use it for broad quality judgments about an application, API, codebase, architecture, or team. Answers come from Spur's modelled memory first. Whether source code is also searched depends on SPUR_CODE_SEARCH: off (default) never, on always, ask only when search_code is true, which the host sets only after the user agrees to a code search. A missing result is not proof that Spur has no knowledge of a feature. No model provider is required inside Spur. Prefer this over search_memory for user-facing answers.",
      inputSchema: z.object({
        question: z.string().min(5).max(500),
        search_code: z.boolean().optional(),
      }),
      outputSchema: hostInvestigationSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ question, search_code }) => {
      const result = await withSpur((service) =>
        service.prepareHostInvestigation(question, { searchCode: search_code }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "search_repository",
    {
      title: "Check source evidence",
      description:
        "Return source excerpts from every connected repository, or from one named repository, for deeper verification or implementation questions. Do not use it to support broad quality judgments about an application, API, codebase, architecture, or team; those queries are refused. Data files are skipped. Refused when SPUR_CODE_SEARCH is off; when it is ask, call this only after the user agrees to a code search. For ordinary business questions, use investigate first.",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        repository: z.string().min(1).max(200).optional(),
      }),
      outputSchema: repositorySearchResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, repository }) => {
      const broadAssessment = requestsBroadQualityAssessment(query);
      const result = broadAssessment
        ? { repositories: [], candidates: [] }
        : await withSpur((service) => service.searchCode(query, repository));
      return {
        content: [
          { type: "text", text: broadAssessment ? BROAD_QUALITY_ASSESSMENT_MESSAGE : JSON.stringify(result, null, 2) },
          { type: "text", text: MCP_BETA_NOTICE },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "record_knowledge_gap",
    {
      title: "Record a knowledge gap",
      description:
        "Record a question Spur's memory could not answer, so it can be modelled later. Repeated questions are counted, not duplicated. Logging an unanswered question again reopens a resolved gap and preserves its resolution history.",
      inputSchema: z.object({
        question: z.string().min(5).max(500),
        reason: z.string().min(2).max(500),
      }),
      outputSchema: knowledgeGapSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ question, reason }) => {
      const result = await withSpur((service) => service.recordKnowledgeGap(question, reason));
      return {
        content: [{ type: "text", text: `Recorded knowledge gap (asked ${result.times_asked} time(s)).` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "list_knowledge_gaps",
    {
      title: "List knowledge gaps",
      description:
        "List knowledge gaps, most asked first. Defaults to open gaps to choose what to model next; request resolved or all to review resolution notes, linked catalog IDs, and who resolved or reopened them.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).default(100),
        status: knowledgeGapFilterSchema.default("open"),
      }),
      outputSchema: z.object({ gaps: z.array(knowledgeGapSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit, status }) => {
      const result = { gaps: await withSpur((service) => service.listKnowledgeGaps(limit, status)) };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "resolve_knowledge_gap",
    {
      title: "Resolve a knowledge gap",
      description:
        "Close a gap after the missing knowledge has been modelled and reviewed against the question. Link at least one active, non-restricted catalog item and explain how it answers the question. Do not close merely because related items exist. Get the user's agreement before resolving. This records who resolved it and why; it does not promote the linked items or create a canned answer. Never include sensitive security details in the note.",
      inputSchema: resolveKnowledgeGapInputSchema.extend({ id: z.string().min(1) }),
      outputSchema: knowledgeGapSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, ...input }) => {
      const result = await withSpur((service) => service.updateKnowledgeGap(id, { ...input, action: "resolve" }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "reopen_knowledge_gap",
    {
      title: "Reopen a knowledge gap",
      description:
        "Reopen a resolved gap when its linked knowledge no longer answers the question. Explain what is still missing. Previous resolution notes and catalog links remain in history. Get the user's agreement before reopening; never include sensitive security details in the note.",
      inputSchema: reopenKnowledgeGapInputSchema.extend({ id: z.string().min(1) }),
      outputSchema: knowledgeGapSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, ...input }) => {
      const result = await withSpur((service) => service.updateKnowledgeGap(id, { ...input, action: "reopen" }));
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "search_memory",
    {
      title: "Find knowledge",
      description:
        "Locate specific retained applications, systems, integrations, information, capabilities, processes, controls, decisions, rules, and observations. Do not use it to support broad quality judgments about an application, API, codebase, architecture, or team; those queries are refused. Results are ranked and limited; no match does not prove the object is absent. This returns raw records, not a user-facing answer; use investigate for a person's question.",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        kinds: z.array(memoryKindSchema).max(memoryKindSchema.options.length).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      outputSchema: z.object({ items: z.array(memoryObjectSchema) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, kinds, limit }) => {
      const broadAssessment = requestsBroadQualityAssessment(query);
      const result = {
        items: broadAssessment || requestsSecurityIssues(query) ? [] :
          (await withSpur((service) => service.searchMemory(query, kinds, limit)))
            .filter((item) => !isSecurityIssueMemory(item)),
      };
      return {
        content: [
          { type: "text", text: broadAssessment ? BROAD_QUALITY_ASSESSMENT_MESSAGE : JSON.stringify(result, null, 2) },
          { type: "text", text: MCP_BETA_NOTICE },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_memory",
    {
      title: "Get a Spur memory object",
      description: "Read one organizational memory object by its stable identifier.",
      inputSchema: z.object({ id: z.string().min(1) }),
      outputSchema: z.object({ item: memoryObjectSchema.nullable() }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const item = await withSpur((service) => service.getMemory(id));
      const result = { item: item && !isSecurityIssueMemory(item) ? item : null };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "edit_memory",
    {
      title: "Edit a Spur memory object",
      description:
        "Edit an existing memory object's kind, title, statement, subjects, entity definition, owner and steward while preserving its evidence and relationships. Set sensitivity to restricted to mask an existing control; a restriction cannot be lifted by an edit. Use only when the user explicitly asks to change that object.",
      inputSchema: editMemoryToolInputSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, kind, title, statement, subjects, entity_definition, sensitivity, owner, steward }) => {
      requireNoSecurityFinding(
        { kind, title, statement, subjects, entity_definition },
        { descriptive: isDescriptiveKind(kind) },
      );
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, id);
        return service.editMemory(id, {
          action: "edit",
          kind,
          title,
          statement,
          subjects,
          entity_definition,
          sensitivity,
          owner,
          steward,
        });
      });
      return {
        content: [{ type: "text", text: `Updated ${result.kind}: ${result.title}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "promote_memory",
    {
      title: "Promote candidate Spur memory",
      description:
        "Promote a candidate memory object to accepted, human-verified organizational knowledge. Use only after the user explicitly approves the promotion and repeat the object ID as confirmation.",
      inputSchema: confirmedMemoryMutationSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, confirmation }) => {
      requireMatchingConfirmation(id, confirmation);
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, id);
        return service.promoteMemory(id);
      });
      return {
        content: [{ type: "text", text: `Promoted ${result.kind}: ${result.title}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "merge_memory",
    {
      title: "Merge duplicate catalog objects",
      description:
        "Merge one active catalog object into another of the same kind, only after the human explicitly chooses the source and target. The target keeps its wording and status; evidence, subjects, and relationships are transferred, while the source is archived for audit. Repeat the exact source ID as confirmation. Conflicting entity definitions or active ISMS mappings block the merge.",
      inputSchema: mergeMemoryInputSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ source_id, target_id, confirmation }) => {
      requireMatchingConfirmation(source_id, confirmation);
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, source_id);
        await requireVisibleMemory(service, target_id);
        return service.mergeMemory(source_id, target_id, confirmation);
      });
      return {
        content: [{ type: "text", text: `Merged ${source_id} into ${target_id}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "archive_memory",
    {
      title: "Archive a Spur memory object",
      description:
        "Recoverably delete a memory object from the active catalog. Use only when the user explicitly requests deletion and repeat the object ID as confirmation.",
      inputSchema: confirmedMemoryMutationSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, confirmation }) => {
      const result = await withSpur(async (service) => {
        await requireVisibleMemory(service, id);
        return service.archiveMemory(id, confirmation);
      });
      return {
        content: [{ type: "text", text: `Archived ${result.kind}: ${result.title}.` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "trace_relationships",
    {
      title: "Explore connections",
      description:
        "Find matching memory and return its known direct relationships for impact and dependency questions. Do not use it to support broad quality judgments about an application, API, codebase, architecture, or team; those queries are refused.",
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      outputSchema: z.object({
        matches: z.array(memoryObjectSchema),
        related: z.array(memoryObjectSchema),
        relationships: z.array(memoryRelationshipSchema),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }) => {
      const broadAssessment = requestsBroadQualityAssessment(query);
      const withheld = requestsSecurityIssues(query);
      const result = broadAssessment || withheld
        ? { matches: [], related: [], relationships: [] }
        : await withSpur((service) => service.traceRelationships(query));
      if (!broadAssessment && !withheld) {
        result.matches = result.matches.filter((item) => !isSecurityIssueMemory(item));
        result.related = result.related.filter((item) => !isSecurityIssueMemory(item));
        const visibleIds = new Set([...result.matches, ...result.related].map((item) => item.id));
        result.relationships = result.relationships.filter((relationship) =>
          visibleIds.has(relationship.from_id) && visibleIds.has(relationship.to_id),
        );
      }
      return {
        content: [
          { type: "text", text: broadAssessment ? BROAD_QUALITY_ASSESSMENT_MESSAGE : JSON.stringify(result, null, 2) },
          { type: "text", text: MCP_BETA_NOTICE },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "record_decision",
    {
      title: "Record an organizational decision",
      description:
        "Store a human-owned decision and relate it to existing organizational memory. Use only after the user has explicitly supplied or approved the decision.",
      inputSchema: recordDecisionInputSchema,
      outputSchema: memoryObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      requireNoSecurityFinding(input);
      const result = await withSpur((service) => service.recordDecision(input));
      return {
        content: [{ type: "text", text: `Recorded decision: ${result.title}` }, { type: "text", text: MCP_BETA_NOTICE }],
        structuredContent: result,
      };
    },
  );

    server.registerTool("create_product_document", {
      title: "Create a PRD or specification",
      description: "Save a draft product requirements document (PRD) or technical specification as unverified memory. Supply Markdown content and related memory IDs. Do not invent evidence or treat proposed requirements as implemented behaviour. Maximum content length is 4,000 characters.",
      inputSchema: productDocumentInputSchema,
      outputSchema: memoryObjectSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async (input) => {
      requireNoSecurityFinding(input);
      const result = await withSpur((service) => service.saveProductDocument(input));
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
  server.registerTool("update_product_document", {
    title: "Update a PRD or specification",
    description: "Replace a draft document's Markdown and related memory IDs. Read the document first. Restricted documents require restricted.write.",
    inputSchema: productDocumentInputSchema.extend({ id: z.string().startsWith("mem_") }),
    outputSchema: memoryObjectSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    requireNoSecurityFinding(input);
    const result = await withSpur((service) => service.saveProductDocument(input, input.id));
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
  });
  server.registerTool("list_product_documents", {
    title: "List PRDs and specifications",
    description: "List stored draft PRDs and technical specifications in the current organisation.",
    inputSchema: z.object({ document_type: z.enum(["prd", "spec"]).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input) => {
    const documents = await withSpur((service) => service.listProductDocuments(input.document_type));
    return { content: [{ type: "text", text: JSON.stringify(documents) }] };
  });
  server.registerTool("get_product_document", {
    title: "Read a PRD or specification",
    description: "Read a stored product document by its memory ID, with normal restricted-data masking.",
    inputSchema: z.object({ id: z.string().startsWith("mem_") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const document = await withSpur((service) => service.getMemory(id));
    if (!document || !["prd", "spec"].includes(String(document.metadata.document_type))) throw new InputError("Product document was not found.");
    return { content: [{ type: "text", text: JSON.stringify(document) }] };
  });

  return server;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function runStdioMcp(): Promise<void> {
  logEvent("info", "mcp_stdio_started", { server: "spur" }, "stderr");
  await serveStdio(() => createSpurMcpServer());
}

if (isMainModule) {
  void runStdioMcp().catch((error: unknown) => {
    logUnexpectedError("mcp_stdio_failed", error);
    process.exitCode = 1;
  });
}
