import path from "node:path";

import { AnalysisService, createAdapter } from "./analysis";
import { appendBetaNotice, betaNoticeInstruction } from "./beta-notice";
import type { Principal } from "./access-store";
import { DEMO_ORGANIZATION, loadOrganizationConfig, type SpurConfig } from "./config";
import { AuthorizationError, InputError, NotFoundError } from "./errors";
import { githubAppConfigured, githubTokenSource } from "./github-app";
import { ismsControlInputSchema, type IsmsControlInput } from "./isms-types";
import { updateKnowledgeGapInputSchema, type KnowledgeGapFilter, type UpdateKnowledgeGapInput } from "./knowledge-gap-types";
import { PostgresMemoryStore } from "./postgres-store";
import { displayBusinessName, searchNameVariants, type ApplicationNaming } from "./naming";
import {
  beginSourceAnalysisInputSchema,
  conversationSchema,
  conversationSummarySchema,
  addEvidenceInputSchema,
  editMemoryInputSchema,
  entityDefinitionSchema,
  investigationResultSchema,
  proposeMemoryAliasInputSchema,
  proposeMemoryObjectsInputSchema,
  proposeRelationshipsInputSchema,
  recordDecisionInputSchema,
  registerSourceInputSchema,
  reviewMemoryAliasInputSchema,
  workspaceSchema,
  type AddEvidenceInput,
  type BeginSourceAnalysisInput,
  type Conversation,
  type ConversationSummary,
  type EditMemoryInput,
  type InvestigationResult,
  type MemoryKind,
  type MemoryAlias,
  type MemoryObject,
  type MemoryRelationship,
  type ProposeMemoryObjectsInput,
  type ProposeMemoryAliasInput,
  type ProposeRelationshipsInput,
  type RecordDecisionInput,
  type RegisterSourceInput,
  type ReviewMemoryAliasInput,
  type Source,
  type SourceAnalysisRun,
  type StoredEvidence,
  type Workspace,
} from "./memory-types";
import type { CodeSearchMode } from "./config";
import {
  GitHubSource,
  LocalGitSource,
  sourceProviderFromConfig,
  type SourceProvider,
} from "./source-provider";
import { relationshipPredicateProblem } from "./relationship-vocabulary";
import {
  BROAD_QUALITY_ASSESSMENT_MESSAGE,
  requestsBroadQualityAssessment,
} from "./question-scope";
import { queryKeywords, retrieveEvidence } from "./search";
import {
  containsSecurityIssue,
  isRestrictedFinding,
  isRestrictedMemory,
  isSecurityIssueEvidence,
  isSecurityIssueMemory,
  maskRestrictedMemory,
  requestsSecurityIssues,
  restrictedMessage,
  SECURITY_WITHHELD_MESSAGE,
} from "./security-disclosure";
import {
  analysisResultSchema,
  type AnalysisMemoryContext,
  type ConversationContextMessage,
  type Evidence,
  type ModelProvider,
} from "./types";
import {
  WIKI_RELATED_KINDS,
  type Wiki,
  type WikiItem,
  type WikiRelatedKind,
} from "./wiki";

const HOST_RECALLED_MEMORY_LIMIT = 12;
const HOST_RELATED_MEMORY_LIMIT = 12;

function questionTitle(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
  return compact.length <= 88 ? compact : `${compact.slice(0, 85)}…`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function boundedContextContent(value: string, limit = 1_200): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function normalizedRecallText(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

const QUESTION_KIND_HINTS: Array<{ pattern: RegExp; kinds: MemoryKind[] }> = [
  {
    pattern: /\b(capability|capabilities|ability|abilities|förmåga|förmågor|vad kan)\b/i,
    kinds: ["capability", "process", "system", "application"],
  },
  {
    pattern: /\b(entity|entities|entitet|entiteter|attribute|attributes|attribut|field|fields|fält|data|information|classification|klassificering|stored|lagras|where)\b/i,
    kinds: ["entity", "information", "system", "integration"],
  },
  {
    pattern: /\b(process|workflow|flow|flöde|hur fungerar|how does|how do)\b/i,
    kinds: ["process", "capability", "system", "integration"],
  },
  {
    pattern: /\b(control|controls|kontroll|kontroller|guard|prevent|hindrar|permission|behörighet|approval|godkänn|limit|validation)\b/i,
    kinds: ["control", "rule", "process"],
  },
  {
    pattern: /\b(rule|rules|regel|regler|policy|allowed|tillåten|måste|must)\b/i,
    kinds: ["rule", "control", "decision"],
  },
  {
    pattern: /\b(system|application|applikation|integration|api|service|tjänst)\b/i,
    kinds: ["system", "application", "integration"],
  },
  {
    pattern: /\b(decision|beslut|why|varför|rationale|motiv)\b/i,
    kinds: ["decision", "rule", "control"],
  },
];

function preferredKinds(question: string): MemoryKind[] {
  return unique(
    QUESTION_KIND_HINTS.flatMap(({ pattern, kinds }) =>
      pattern.test(question) ? kinds : [],
    ),
  );
}

function prioritizeMemory(
  items: MemoryObject[],
  kinds: MemoryKind[],
): MemoryObject[] {
  const kindRank = new Map(kinds.map((kind, index) => [kind, index]));
  return items
    .map((item, index) => ({
      item,
      score:
        (items.length - index) * 4 +
        (item.state === "accepted" ? 6 : 0) +
        (kindRank.has(item.kind)
          ? Math.max(4, 16 - (kindRank.get(item.kind) ?? 0) * 3)
          : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

export class SpurService {
  private readonly analysis: AnalysisService;

  constructor(
    private readonly repository: SourceProvider,
    private readonly store: PostgresMemoryStore,
    adapter: ReturnType<typeof createAdapter>,
    private readonly synthesisProvider: ModelProvider,
    private readonly actor: string,
    private readonly runtimeRoot = process.cwd(),
    private readonly organization: { slug: string; name: string } = DEMO_ORGANIZATION,
    private readonly additionalRepositories: SourceProvider[] = [],
    private readonly codeSearch: CodeSearchMode = "ask",
    private readonly applicationNaming?: ApplicationNaming,
    private readonly securityContact?: string,
    private readonly authorization = { restrictedRead: false, restrictedWrite: true },
    private readonly githubEnvironment: NodeJS.ProcessEnv = process.env,
    private readonly multiTenant = false,
  ) {
    this.analysis = new AnalysisService(repository, adapter);
  }

  private isHidden(item: MemoryObject): boolean {
    return isSecurityIssueMemory(item) ||
      (isRestrictedFinding(item) && !this.authorization.restrictedRead);
  }

  private displayMemory(item: MemoryObject): MemoryObject {
    if (isRestrictedMemory(item) && !this.authorization.restrictedRead) {
      return maskRestrictedMemory(item, this.securityContact);
    }
    if (!this.applicationNaming) return item;
    const display = (value: string) => displayBusinessName(value, this.applicationNaming);
    return {
      ...item,
      title: display(item.title),
      statement: display(item.statement),
      subjects: item.subjects.map(display),
    };
  }

  private async displayRelationship(relationship: MemoryRelationship): Promise<MemoryRelationship> {
    const [from, to] = await Promise.all([
      this.store.getMemory(relationship.from_id),
      this.store.getMemory(relationship.to_id),
    ]);
    return !this.authorization.restrictedRead &&
      ((from && isRestrictedMemory(from)) || (to && isRestrictedMemory(to)))
      ? { ...relationship, predicate: "related_to", metadata: {} }
      : relationship;
  }

  private async questionTargetsRestrictedMemory(
    question: string,
    restricted: MemoryObject[],
    recalled: MemoryObject[],
  ): Promise<boolean> {
    if (this.authorization.restrictedRead || restricted.length === 0) return false;
    const keywords = queryKeywords(question);
    if (keywords.length === 0) return false;
    const unrestrictedCount = recalled.filter((item) => !isRestrictedMemory(item)).length;
    const requiredMatches = keywords.length === 1 && unrestrictedCount === 0 ? 1 : 2;
    const rawItems = (await Promise.all(
      restricted.map((item) => this.store.getMemory(item.id)),
    )).filter((item): item is MemoryObject => item !== null);
    return rawItems.some((item) => {
      const text = normalizedRecallText([
        item.title,
        item.statement,
        ...item.subjects,
      ].join(" "));
      return keywords.filter((keyword) => text.includes(keyword)).length >= requiredMatches;
    });
  }

  private async searchStoredMemory(
    query: string,
    limit: number,
    kinds?: MemoryKind[],
  ): Promise<MemoryObject[]> {
    return uniqueById(
      (await Promise.all(searchNameVariants(query, this.applicationNaming)
        .map((variant) => this.store.searchMemory(variant, limit, kinds))))
        .flat()
        .filter((item) => !this.isHidden(item)),
    ).slice(0, limit).map((item) => this.displayMemory(item));
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  private async syncRepositorySource(repository = this.repository): Promise<{
    source: Source;
    application: MemoryObject | null;
  }> {
    const primary = repository === this.repository;
    if (!repository.root) {
      const timestamp = new Date().toISOString();
      return { source: {
        id: "", kind: "repository", name: "No connected repository", locator: "", status: "disabled", enabled: false,
        created_at: timestamp, updated_at: timestamp, last_synced_at: null, metadata: {},
      }, application: null };
    }
    const storedSources = await this.store.listSources({ includeRemoved: true });
    const removed = storedSources.find((candidate) => candidate.kind === "repository" &&
      candidate.metadata.repository_root === repository.root && candidate.metadata.removed_at);
    if (removed) return { source: removed, application: null };
    const metadata = await repository.metadata();
    const timestamp = new Date().toISOString();
    const existingSource = storedSources.find((candidate) =>
      candidate.kind === "repository" &&
      (candidate.locator === metadata.remoteUrl || candidate.metadata.repository_root === repository.root),
    );
    if (existingSource?.metadata.removed_at) return { source: existingSource, application: null };
    const source = await this.store.upsertSource({
      id: existingSource?.id,
      kind: "repository",
      name: metadata.name,
      locator: metadata.remoteUrl ?? repository.root,
      status: "connected",
      enabled: true,
      lastSyncedAt: timestamp,
      metadata: {
        ...(existingSource?.metadata ?? {}),
        commit_sha: metadata.commitSha,
        access: "read_only",
        // Only the primary repository is active; additional ones are
        // modelled alongside it and must not deactivate it.
        active: primary,
        additional: !primary,
        repository_root: repository.root,
        remote_url: metadata.remoteUrl,
      },
    });
    if (source.metadata.removed_at) return { source, application: null };
    if (primary) await this.store.markRepositoryActive(source.id);
    const applicationName = primary
      ? this.applicationNaming?.canonicalName ?? metadata.name
      : metadata.name;
    const applicationStatement = `${applicationName} is the application currently connected to Spur for evidence-backed investigation.`;
    const configuredApplications = (await this.store.listAllMemory(["application"])).filter((item) =>
      item.metadata.configured_source === true && item.source_ids.includes(source.id),
    );
    const existingApplication = configuredApplications.find((item) => item.title === applicationName)
      ?? configuredApplications[0];
    const application = existingApplication
      ? existingApplication.title === applicationName &&
        existingApplication.statement === applicationStatement &&
        existingApplication.subjects.length === 1 &&
        existingApplication.subjects[0] === applicationName
        ? existingApplication
        : (await this.store.updateMemory(existingApplication.id, {
        title: applicationName,
        statement: applicationStatement,
        subjects: [applicationName],
        }))!
      : await this.store.upsertMemory({
        kind: "application",
        title: applicationName,
        statement: applicationStatement,
        state: "accepted",
        authority: "system",
        confidence: 1,
        subjects: [applicationName],
        sourceIds: [source.id],
        sourceVersion: metadata.commitSha,
        metadata: { configured_source: true },
      });
    return { source, application };
  }

  async repositoryStatus(
    options: { synchronizeRepository?: boolean } = {},
  ): Promise<Workspace["repository"]> {
    if (options.synchronizeRepository === false) {
      const metadata = await this.repository.metadata();
      return {
        ready: true,
        name: metadata.name,
        commit_sha: metadata.commitSha,
      };
    }
    const { source } = await this.syncRepositorySource();
    return {
      ready: source.enabled && !source.metadata.removed_at,
      name: source.name,
      commit_sha: String(source.metadata.commit_sha ?? ""),
    };
  }

  async workspace(options: { synchronizeRepository?: boolean } = {}): Promise<Workspace> {
    // MCP preflight reads opt out of synchronization so an agent can inspect
    // the target before the user approves modeling writes. UI/API callers keep
    // the established synchronization behavior by default.
    const repository = await this.repositoryStatus(options);
    const [sources, memoryItems, relationships, counts] = await Promise.all([
      this.store.listSources(),
      this.store.listAllMemory(),
      this.store.listRelationships(),
      this.store.counts(),
    ]);
    return workspaceSchema.parse({
      organization: this.organization,
      repository,
      provider: this.synthesisProvider,
      synthesis_provider: this.synthesisProvider,
      actor: this.actor,
      mcp: {
        ready: !this.multiTenant,
        transport: "stdio",
        server_name: `spur-${this.organization.slug}`,
        command: this.multiTenant ? "" : process.execPath,
        args: this.multiTenant ? [] : [
          path.resolve(this.runtimeRoot, "node_modules/tsx/dist/cli.mjs"),
          path.resolve(this.runtimeRoot, "src/mcp/server.ts"),
        ],
        cwd: this.multiTenant ? "" : this.runtimeRoot,
        repository_root: this.repository.root,
      },
      sources,
      memory: memoryItems
        .filter((item) => !this.isHidden(item))
        .map((item) => this.displayMemory(item)),
      relationships: await Promise.all(relationships
        .map((relationship) => this.displayRelationship(relationship))),
      counts,
    });
  }

  async wiki(): Promise<Wiki> {
    const [rawItems, rawRelationships] = await Promise.all([
      this.store.listAllMemory(),
      this.store.listRelationships(),
    ]);
    const visibleItems = rawItems
      .filter((item) => !this.isHidden(item))
      .map((item) => this.displayMemory(item));
    const visibleById = new Map(visibleItems.map((item) => [item.id, item]));
    const relationships = rawRelationships.filter((relationship) =>
      visibleById.has(relationship.from_id) && visibleById.has(relationship.to_id),
    );
    const neighbours = new Map<string, Set<string>>();
    for (const relationship of relationships) {
      const from = neighbours.get(relationship.from_id) ?? new Set<string>();
      const to = neighbours.get(relationship.to_id) ?? new Set<string>();
      from.add(relationship.to_id);
      to.add(relationship.from_id);
      neighbours.set(relationship.from_id, from);
      neighbours.set(relationship.to_id, to);
    }
    const relatedKinds = new Set<string>(WIKI_RELATED_KINDS);
    const linkedIds = new Set<string>();
    const item = (memory: MemoryObject): WikiItem => ({
      id: memory.id,
      kind: memory.kind,
      title: memory.title,
      statement: memory.statement,
      state: memory.state,
      authority: memory.authority,
      confidence: memory.confidence,
      subjects: memory.subjects,
      evidence_ids: memory.evidence_ids,
      source_ids: memory.source_ids,
      source_version: memory.source_version,
      created_at: memory.created_at,
      updated_at: memory.updated_at,
      metadata: memory.metadata,
    });
    const sorted = (items: MemoryObject[]) => items
      .sort((left, right) =>
        Number(right.state === "accepted") - Number(left.state === "accepted") ||
        left.title.localeCompare(right.title),
      )
      .map(item);
    const capabilities = visibleItems
      .filter((memory) => memory.kind === "capability")
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((capability) => {
        const found = new Map<string, MemoryObject>();
        const visited = new Set([capability.id]);
        let frontier = [capability.id];
        for (let depth = 0; depth < 2; depth += 1) {
          const next: string[] = [];
          for (const current of frontier) {
            for (const neighbourId of neighbours.get(current) ?? []) {
              if (visited.has(neighbourId)) continue;
              visited.add(neighbourId);
              const neighbour = visibleById.get(neighbourId);
              if (!neighbour || neighbour.kind === "capability") continue;
              if (relatedKinds.has(neighbour.kind)) found.set(neighbour.id, neighbour);
              next.push(neighbour.id);
            }
          }
          frontier = next;
        }
        for (const id of found.keys()) linkedIds.add(id);
        const byKind = (kind: WikiRelatedKind) => sorted(
          [...found.values()].filter((memory) => memory.kind === kind),
        );
        return {
          capability: item(capability),
          processes: byKind("process"),
          rules: byKind("rule"),
          controls: byKind("control"),
          entities: byKind("entity"),
        };
      });
    const ungroupedByKind = (kind: WikiRelatedKind) => sorted(visibleItems.filter((memory) =>
      memory.kind === kind && !linkedIds.has(memory.id),
    ));
    return {
      organization: this.organization,
      generated_at: new Date().toISOString(),
      articles: sorted([...visibleItems]),
      links: relationships.map((relationship) => ({
        id: relationship.id,
        from_id: relationship.from_id,
        // Same masking as displayRelationship: a predicate can describe a
        // restricted control.
        predicate: !this.authorization.restrictedRead &&
          [relationship.from_id, relationship.to_id].some((id) => isRestrictedMemory(visibleById.get(id)!))
          ? "related_to"
          : relationship.predicate,
        to_id: relationship.to_id,
      })),
      capabilities,
      ungrouped: {
        processes: ungroupedByKind("process"),
        rules: ungroupedByKind("rule"),
        controls: ungroupedByKind("control"),
        entities: ungroupedByKind("entity"),
      },
    };
  }

  async searchMemory(query: string, kinds?: MemoryKind[], limit = 10): Promise<MemoryObject[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new InputError("Search must contain at least 2 characters.");
    }
    return this.searchStoredMemory(trimmed, limit, kinds);
  }

  async listIsmsControls() {
    return this.store.listIsmsControls();
  }

  async searchIsmsControls(query: string, limit = 10) {
    if (query.trim().length < 2) throw new InputError("Search must contain at least 2 characters.");
    return this.store.searchIsmsControls(query, limit);
  }

  async getIsmsControlDetail(id: string) {
    const control = await this.store.getIsmsControl(id);
    if (!control || control.archived_at) throw new NotFoundError("ISMS control was not found.");
    const linked_memory = (await Promise.all(control.linked_memory_ids
      .map((memoryId) => this.getMemory(memoryId))))
      .filter((item): item is MemoryObject => Boolean(item));
    return { control, linked_memory, revisions: await this.store.listIsmsControlRevisions(id) };
  }

  async saveIsmsControl(input: IsmsControlInput, id?: string, expectedVersion?: number) {
    return this.store.saveIsmsControl(ismsControlInputSchema.parse(input), this.actor, id, expectedVersion);
  }

  async approveIsmsControl(id: string, expectedVersion: number) {
    return this.store.changeIsmsControlState(id, "approved", this.actor, expectedVersion);
  }

  async archiveIsmsControl(id: string, expectedVersion: number, confirmation: string) {
    if (confirmation !== id) throw new InputError("Confirmation must match the ISMS control ID.");
    return this.store.changeIsmsControlState(id, "archived", this.actor, expectedVersion);
  }

  private async memoryContextForQuestion(query: string): Promise<{
    recalled: MemoryObject[];
    context: AnalysisMemoryContext;
  }> {
    const kinds = preferredKinds(query);
    const seeds = prioritizeMemory(
      (await this.searchStoredMemory(query, 12)).filter((item) => !this.isHidden(item)),
      kinds,
    ).slice(0, 8);
    const seedIds = new Set(seeds.map((item) => item.id));
    const candidateRelationships = uniqueById(
      (await Promise.all(seeds.map((item) => this.store.listRelationships(item.id)))).flat(),
    ).slice(0, 32);
    const relatedIds = unique(
      candidateRelationships.flatMap((relationship) => [
        relationship.from_id,
        relationship.to_id,
      ]),
    ).filter((id) => !seedIds.has(id));
    const related = prioritizeMemory(
      (await Promise.all(relatedIds.map((id) => this.getMemory(id))))
        .filter((item): item is MemoryObject => item !== null && !this.isHidden(item)),
      kinds,
    ).slice(0, 12);
    const recalled = uniqueById([...seeds, ...related]);
    const recalledIds = new Set(recalled.map((item) => item.id));
    const visibleRelationships = await Promise.all(candidateRelationships
      .filter(
        (relationship) =>
          recalledIds.has(relationship.from_id) &&
          recalledIds.has(relationship.to_id),
      )
      .map((relationship) => this.displayRelationship(relationship)));

    return {
      recalled,
      context: {
        items: recalled.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          statement: item.statement,
          state: item.state,
          authority: item.authority,
          confidence: item.confidence,
          subjects: item.subjects,
          aliases: (item.aliases ?? []).map((alias) => ({
            name: alias.name,
            status: alias.status,
            origin: alias.origin,
            scope: alias.scope,
            actor: alias.actor,
          })),
          metadata: item.metadata,
        })),
        relationships: visibleRelationships.map((relationship) => ({
            from_id: relationship.from_id,
            predicate: relationship.predicate,
            to_id: relationship.to_id,
            metadata: relationship.metadata,
        })),
      },
    };
  }

  async listConversations(limit = 20): Promise<ConversationSummary[]> {
    return (await this.store.listConversations(this.actor, limit))
      .map((conversation) => {
        const summary = conversationSummarySchema.parse(conversation);
        return requestsSecurityIssues(summary.title) || containsSecurityIssue(summary.title)
          ? { ...summary, title: "Security review request" }
          : { ...summary, title: displayBusinessName(summary.title, this.applicationNaming) };
      });
  }

  async getConversation(id: string): Promise<Conversation> {
    const conversation = await this.store.getConversation(id, this.actor);
    if (!conversation) throw new NotFoundError("Conversation was not found.");
    const turns: InvestigationResult[] = [];
    for (const investigationId of conversation.investigationIds) {
      const investigation = await this.store.getInvestigation(investigationId);
      if (!investigation) {
        throw new NotFoundError("A conversation turn was not found.");
      }
      const storedAnalysis = analysisResultSchema.parse(investigation.analysis);
      const recalledItems = await Promise.all(
        investigation.recalledMemoryIds.map((memoryId) => this.store.getMemory(memoryId)),
      );
      const restricted = !this.authorization.restrictedRead &&
        recalledItems.some((item) => item && isRestrictedMemory(item));
      const withheld = requestsSecurityIssues(investigation.question) ||
        containsSecurityIssue(investigation.answer) ||
        containsSecurityIssue(JSON.stringify(storedAnalysis));
      const analysis = withheld || restricted ? analysisResultSchema.parse({
        ...storedAnalysis,
        summary: appendBetaNotice(
          withheld ? SECURITY_WITHHELD_MESSAGE : restrictedMessage(this.securityContact),
          investigation.question,
        ),
        memory_ids: withheld ? [] : investigation.recalledMemoryIds,
        observed_behavior: [],
        business_rationale: { status: "unknown", statement: "Not disclosed.", evidence_ids: [] },
        verified_rule: {
          status: "unverified",
          statement: "Not disclosed.",
          verified_by_role: null,
          verified_on: null,
          evidence_ids: [],
        },
        evidence: [],
        uncertainties: [],
        status: "no_evidence",
      }) : {
        ...storedAnalysis,
        summary: appendBetaNotice(
          displayBusinessName(storedAnalysis.summary, this.applicationNaming),
          investigation.question,
        ),
      };
      const [recalledMemory, learnedMemory] = await Promise.all([
        Promise.all(investigation.recalledMemoryIds.map((memoryId) => this.getMemory(memoryId))),
        Promise.all(investigation.learnedMemoryIds.map((memoryId) => this.getMemory(memoryId))),
      ]);
      turns.push(investigationResultSchema.parse({
        id: investigation.id,
        conversation_id: conversation.id,
        question: investigation.question,
        answer: appendBetaNotice(
          withheld
            ? SECURITY_WITHHELD_MESSAGE
            : restricted
            ? restrictedMessage(this.securityContact)
            : displayBusinessName(investigation.answer, this.applicationNaming),
          investigation.question,
        ),
        analysis,
        recalled_memory: withheld ? [] : recalledMemory
          .filter((item): item is MemoryObject => item !== null && !this.isHidden(item)),
        learned_memory: withheld ? [] : learnedMemory
          .filter((item): item is MemoryObject => item !== null && !this.isHidden(item)),
        created_at: investigation.createdAt,
      }));
    }
    return conversationSchema.parse({
      id: conversation.id,
      title: requestsSecurityIssues(conversation.title) || containsSecurityIssue(conversation.title)
        ? "Security review request"
        : displayBusinessName(conversation.title, this.applicationNaming),
      repository_commit_sha: conversation.repository_commit_sha,
      turn_count: turns.length,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      turns,
    });
  }

  async getMemory(id: string): Promise<MemoryObject | null> {
    const item = await this.store.getMemory(id);
    return item && typeof item.metadata.deleted_at !== "string" && !this.isHidden(item)
      ? this.displayMemory(item)
      : null;
  }

  async getEvidence(id: string): Promise<StoredEvidence | null> {
    const evidence = await this.store.getEvidence(id);
    if (!evidence) return null;
    const owners = await this.store.getEvidenceOwners(id);
    return owners.length > 0 && owners.every((item) =>
      (this.authorization.restrictedRead || !isRestrictedMemory(item)) && !this.isHidden(item))
      ? evidence
      : null;
  }

  async getMemoryDetail(id: string): Promise<{
    item: MemoryObject;
    evidence: StoredEvidence[];
    alias_evidence: Record<string, StoredEvidence[]>;
    relationships: MemoryRelationship[];
    related: MemoryObject[];
  }> {
    const item = await this.getMemory(id);
    if (!item) throw new NotFoundError("Memory object was not found.");
    const relationships = await this.store.listRelationships(id);
    const relatedIds = unique(
      relationships.flatMap((relationship) => [relationship.from_id, relationship.to_id]),
    ).filter((relatedId) => relatedId !== id);
    const related = (await Promise.all(relatedIds.map((relatedId) => this.getMemory(relatedId))))
      .filter((relatedItem): relatedItem is MemoryObject => Boolean(relatedItem));
    const visibleIds = new Set(related.map((relatedItem) => relatedItem.id));
    const evidence = (await Promise.all(item.evidence_ids.map((evidenceId) => this.getEvidence(evidenceId))))
      .filter((entry): entry is StoredEvidence => Boolean(entry));
    const aliasEvidenceEntries = await Promise.all((item.aliases ?? []).map(async (alias) => [
      alias.id,
      (await Promise.all(alias.evidence_ids.map((evidenceId) => this.getEvidence(evidenceId))))
        .filter((entry): entry is StoredEvidence => Boolean(entry)),
    ] as const));
    const displayedRelationships = await Promise.all(relationships
      .filter((relationship) =>
        visibleIds.has(relationship.from_id === id ? relationship.to_id : relationship.from_id),
      ).map((relationship) => this.displayRelationship(relationship)));
    return {
      item,
      evidence,
      alias_evidence: Object.fromEntries(aliasEvidenceEntries),
      relationships: displayedRelationships,
      related,
    };
  }

  async editMemory(id: string, input: EditMemoryInput): Promise<MemoryObject> {
    const parsed = editMemoryInputSchema.parse(input);
    const current = await this.store.getMemory(id);
    if (!current || current.metadata.deleted_at) throw new NotFoundError("Memory object was not found.");
    if ((isRestrictedMemory(current) || parsed.sensitivity === "restricted") &&
        !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    if (current.kind === "application" && current.metadata.configured_source === true) {
      throw new InputError("The connected application is managed from Sources and cannot be edited here.");
    }
    const timestamp = new Date().toISOString();
    const updated = await this.store.updateMemory(id, {
      kind: parsed.kind,
      title: displayBusinessName(parsed.title, this.applicationNaming),
      statement: parsed.statement,
      subjects: parsed.subjects.map((subject) => displayBusinessName(subject, this.applicationNaming)),
      metadata: {
        ...current.metadata,
        ...(parsed.kind === "entity"
          ? { entity_definition: parsed.entity_definition }
          : { entity_definition: undefined }),
        ...(parsed.sensitivity ? { sensitivity: parsed.sensitivity } : {}),
        ...(parsed.owner ? { owner: parsed.owner } : {}),
        ...(parsed.steward ? { steward: parsed.steward } : {}),
        last_edited_at: timestamp,
        last_edited_by: this.actor,
      },
    });
    if (!updated) throw new NotFoundError("Memory object was not found.");
    return this.displayMemory(updated);
  }

  async proposeMemoryAlias(
    input: ProposeMemoryAliasInput,
    submissionChannel: "mcp" | "portal" | "service" = "service",
  ): Promise<MemoryAlias> {
    const parsed = proposeMemoryAliasInputSchema.parse(input);
    if (containsSecurityIssue(parsed.name)) throw new InputError(SECURITY_WITHHELD_MESSAGE);
    const current = await this.store.getMemory(parsed.memory_id);
    if (!current || current.metadata.deleted_at || this.isHidden(current)) {
      throw new NotFoundError("Memory object was not found.");
    }
    if (isRestrictedMemory(current) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    if (current.title.trim().localeCompare(parsed.name, undefined, { sensitivity: "base" }) === 0) {
      throw new InputError("Alias must differ from the canonical title.");
    }
    return this.store.upsertMemoryAlias({
      memoryId: current.id,
      name: parsed.name,
      status: "proposed",
      origin: "user",
      scope: "organization",
      actor: this.actor,
      metadata: {
        epistemic_status: "user_generated_suggestion",
        submission_channel: submissionChannel,
      },
    });
  }

  async reviewMemoryAlias(input: ReviewMemoryAliasInput): Promise<MemoryAlias> {
    const parsed = reviewMemoryAliasInputSchema.parse(input);
    if (parsed.confirmation !== parsed.alias_id) {
      throw new InputError("Confirmation must match the alias ID.");
    }
    const current = await this.store.getMemory(parsed.memory_id);
    if (!current || current.metadata.deleted_at || this.isHidden(current)) {
      throw new NotFoundError("Memory object was not found.");
    }
    if (isRestrictedMemory(current) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    const alias = await this.store.getMemoryAlias(parsed.alias_id);
    if (!alias || alias.memory_id !== current.id) throw new NotFoundError("Alias was not found.");
    return this.store.reviewMemoryAlias(
      current.id,
      alias.id,
      parsed.action === "verify" ? "verified" : "rejected",
      this.actor,
      parsed.note,
    );
  }

  async promoteMemory(id: string): Promise<MemoryObject> {
    const current = await this.store.getMemory(id);
    if (!current || current.metadata.deleted_at) throw new NotFoundError("Memory object was not found.");
    if (isRestrictedMemory(current) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    if (current.kind === "application" && current.metadata.configured_source === true) {
      throw new InputError("The connected application is managed from Sources and cannot be promoted here.");
    }
    if (current.state !== "candidate") {
      throw new InputError("Only candidate memory can be promoted.");
    }
    const timestamp = new Date().toISOString();
    const promoted = await this.store.updateMemory(id, {
      state: "accepted",
      authority: "person",
      confidence: 1,
      actor: this.actor,
      metadata: {
        ...current.metadata,
        epistemic_status: "human_verified",
        promoted_at: timestamp,
        promoted_by: this.actor,
      },
    });
    if (!promoted) throw new NotFoundError("Memory object was not found.");
    return this.displayMemory(promoted);
  }

  async archiveMemory(id: string, confirmation: string): Promise<MemoryObject> {
    if (confirmation !== id) {
      throw new InputError("Confirmation must match the memory object ID.");
    }
    const current = await this.store.getMemory(id);
    if (!current || current.metadata.deleted_at) throw new NotFoundError("Memory object was not found.");
    if (isRestrictedMemory(current) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    if (current.kind === "application" && current.metadata.configured_source === true) {
      throw new InputError("The connected application is managed from Sources and cannot be deleted here.");
    }
    const archived = await this.store.updateMemory(id, {
      state: "deleted",
      metadata: {
        ...current.metadata,
        deleted_at: new Date().toISOString(),
        deleted_by: this.actor,
        state_before_delete: current.state,
      },
    });
    if (!archived) throw new NotFoundError("Memory object was not found.");
    return this.displayMemory(archived);
  }

  async mergeMemory(sourceId: string, targetId: string, confirmation: string): Promise<MemoryObject> {
    if (confirmation !== sourceId) {
      throw new InputError("Confirmation must match the source object ID.");
    }
    const [source, target] = await Promise.all([
      this.store.getMemory(sourceId),
      this.store.getMemory(targetId),
    ]);
    if ((source && isRestrictedMemory(source) || target && isRestrictedMemory(target)) &&
        !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    return this.displayMemory(await this.store.mergeMemory(sourceId, targetId, this.actor));
  }

  get codeSearchMode(): CodeSearchMode {
    return this.codeSearch;
  }

  private async restrictedPathsForRepository(repository: SourceProvider): Promise<Set<string>> {
    if (this.authorization.restrictedRead) return new Set();
    const restricted = await this.store.listRestrictedMemory();
    const evidence = (await Promise.all(
      restricted.flatMap((item) => item.evidence_ids).map((id) => this.store.getEvidence(id)),
    )).filter((item): item is StoredEvidence => Boolean(item));
    const paths = await Promise.all(evidence.map(async (item) => {
      const source = await this.store.getSource(item.source_id);
      return source?.metadata.repository_root === repository.root ? item.path : null;
    }));
    return new Set(paths.filter((item): item is string => item !== null));
  }

  private async matchesRestrictedText(query: string): Promise<boolean> {
    if (this.authorization.restrictedRead) return false;
    const terms = queryKeywords(query);
    if (terms.length === 0) return false;
    const restricted = await this.store.listRestrictedMemory();
    for (const item of restricted) {
      const excerpts = (await Promise.all(item.evidence_ids
        .map((id) => this.store.getEvidence(id))))
        .map((evidence) => evidence?.excerpt ?? "").join(" ");
      const text = `${item.title} ${item.statement} ${item.subjects.join(" ")} ${excerpts}`.toLowerCase();
      if (terms.filter((term) => text.includes(term)).length >= Math.min(2, terms.length)) return true;
    }
    return false;
  }

  async searchRepository(query: string, repository = this.repository) {
    const sources = await this.store.listSources({ includeRemoved: true });
    if (sources.some((source) => source.kind === "repository" && source.metadata.removed_at &&
        (source.metadata.repository_root === repository.root || source.locator === repository.root))) {
      throw new InputError("This source has been removed. Register it again before searching its code.");
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new InputError("Repository search must contain at least 2 characters.");
    }
    if (requestsSecurityIssues(trimmed) || await this.matchesRestrictedText(trimmed)) {
      const metadata = await repository.metadata();
      return { repo: metadata.name, commitSha: metadata.commitSha, analyzedFiles: 0, candidates: [] };
    }
    const restrictedPaths = await this.restrictedPathsForRepository(repository);
    const result = await retrieveEvidence(repository, trimmed);
    return {
      ...result,
      candidates: result.candidates.filter((candidate) =>
        !isSecurityIssueEvidence(candidate) && !restrictedPaths.has(candidate.path)),
    };
  }

  // Searches every configured repository, or one when a name is given, and
  // ranks the excerpts together. Refused when code search is off.
  async searchCode(query: string, repositoryName?: string) {
    if (this.codeSearch === "off") {
      throw new InputError(
        "Code search is off. Set SPUR_CODE_SEARCH to ask or on to allow it.",
      );
    }
    const configuredRepositories = await this.configuredRepositories();
    const repositories = repositoryName
      ? [await this.findRepository(repositoryName)]
      : configuredRepositories;
    const results = await Promise.all(
      repositories.map((repository) => this.searchRepository(query, repository)),
    );
    return {
      repositories: results.map((result) => ({
        name: result.repo,
        commit_sha: result.commitSha,
        analyzed_files: result.analyzedFiles,
      })),
      candidates: results
        .flatMap((result) =>
          result.candidates.map((candidate) => ({
            ...candidate,
            repo: result.repo,
            commit_sha: result.commitSha,
          })),
        )
        .sort((left, right) => right.score - left.score),
    };
  }

  recordKnowledgeGap(question: string, reason: string) {
    const trimmed = question.trim();
    if (trimmed.length < 5) throw new InputError("Question must contain at least 5 characters.");
    return this.store.recordKnowledgeGap(trimmed.slice(0, 500), reason.trim() || "Memory did not answer.", this.actor);
  }

  listKnowledgeGaps(limit?: number, status: KnowledgeGapFilter = "all") {
    return this.store.listKnowledgeGaps(limit, status);
  }

  updateKnowledgeGap(id: string, input: UpdateKnowledgeGapInput) {
    const parsed = updateKnowledgeGapInputSchema.parse(input);
    return this.store.updateKnowledgeGap(id, parsed, this.actor);
  }

  async prepareHostInvestigation(question: string, options: { searchCode?: boolean } = {}) {
    const trimmed = question.trim();
    if (trimmed.length < 5) {
      throw new InputError("Question must contain at least 5 characters.");
    }
    if (trimmed.length > 500) {
      throw new InputError("Question must not exceed 500 characters.");
    }

    if (requestsBroadQualityAssessment(trimmed)) {
      return {
        question: trimmed,
        code_search: { mode: this.codeSearch, searched: false, repositories: [] },
        recalled_memory: [],
        related_memory: [],
        relationships: [],
        memory_evidence: [],
        repository_evidence: [],
        packet_limits: {
          recalled_memory: HOST_RECALLED_MEMORY_LIMIT,
          related_memory: HOST_RELATED_MEMORY_LIMIT,
          relationships: 24,
          memory_evidence: 10,
          repository_evidence: 6,
          lines_per_excerpt: 40,
        },
        answering_instructions: [
          BROAD_QUALITY_ASSESSMENT_MESSAGE,
          "Do not inspect memory or source code, answer the assessment, or record it as a knowledge gap. Invite a narrower evidence-checkable question instead.",
          betaNoticeInstruction(trimmed),
        ],
      };
    }

    if (this.codeSearch === "off" && options.searchCode) {
      throw new InputError(
        "Code search is off. Set SPUR_CODE_SEARCH to ask or on to allow it.",
      );
    }
    const withheld = requestsSecurityIssues(trimmed);
    // Memory answers first. Code is searched only when the mode allows it
    // without asking, or after the user agreed (search_code).
    const initialMatches = withheld
      ? []
      : await this.searchStoredMemory(trimmed, HOST_RECALLED_MEMORY_LIMIT);
    const restrictedMatches = initialMatches.filter(isRestrictedMemory);
    const restrictedMatch = await this.questionTargetsRestrictedMemory(
      trimmed,
      restrictedMatches,
      initialMatches,
    );
    const matches = restrictedMatch
      ? initialMatches
      : initialMatches.filter((item) =>
        this.authorization.restrictedRead || !isRestrictedMemory(item));
    const searched = !withheld && !restrictedMatch &&
      (this.codeSearch === "on" || (this.codeSearch === "ask" && options.searchCode === true));
    const code = searched ? await this.searchCode(trimmed) : null;
    const candidateRelationships = uniqueById(
      (await Promise.all(matches.map((item) => this.store.listRelationships(item.id)))).flat(),
    ).slice(0, 24);
    const matchIds = new Set(matches.map((item) => item.id));
    const relatedIds = unique(
      candidateRelationships.flatMap((relationship) => [relationship.from_id, relationship.to_id]),
    ).filter((id) => !matchIds.has(id));
    const related = (await Promise.all(
      relatedIds.slice(0, HOST_RELATED_MEMORY_LIMIT).map((id) => this.getMemory(id)),
    ))
      .filter((item): item is MemoryObject => item !== null &&
        !this.isHidden(item) &&
        (this.authorization.restrictedRead || restrictedMatch || !isRestrictedMemory(item)));
    const hasRestrictedMemory = restrictedMatch;
    const visibleIds = new Set([...matches, ...related].map((item) => item.id));
    const relationships = candidateRelationships.filter((relationship) =>
      visibleIds.has(relationship.from_id) && visibleIds.has(relationship.to_id),
    );
    const memoryEvidence = (await Promise.all(unique(
      [...matches, ...related].flatMap((item) => [
        ...item.evidence_ids,
        ...(item.aliases ?? [])
          .filter((alias) => alias.status !== "rejected")
          .flatMap((alias) => alias.evidence_ids),
      ]),
    ).slice(0, 10).map((id) => this.getEvidence(id)))).flatMap((evidence) => {
      if (!evidence || isSecurityIssueEvidence(evidence)) return [];
      const excerptLines = evidence.excerpt.split("\n").slice(0, 40);
      return [{
        ...evidence,
        excerpt: excerptLines.join("\n"),
        end_line: Math.min(
          evidence.end_line,
          evidence.start_line + Math.max(0, excerptLines.length - 1),
        ),
      }];
    });

    const codeInstruction = hasRestrictedMemory
      ? "Do not search the repository or use another source to reconstruct restricted control details."
      : this.codeSearch === "off"
      ? "Answer from Spur's memory only; code search is turned off. If this packet does not answer the question, run search_memory once with a shorter or alternative business phrasing and limit 20 before calling record_knowledge_gap."
      : searched
      ? "repository_evidence comes from a search of every connected repository's code, not from modelled memory. Prefer memory. When a statement rests only on repository evidence, say it is not yet modelled in Spur. If neither answers the question, run search_memory once with a shorter or alternative business phrasing and limit 20 before calling record_knowledge_gap."
      : "Answer from Spur's memory; the code was not searched. If memory does not fully answer the question, say what is missing, run search_memory once with a shorter or alternative business phrasing and limit 20, and offer to search the code of every connected repository. Call investigate again with search_code true only after the user agrees. Call record_knowledge_gap only if the second memory search also fails.";

    return {
      question: trimmed,
      code_search: {
        mode: this.codeSearch,
        searched,
        repositories: code?.repositories ?? [],
      },
      recalled_memory: matches,
      related_memory: related,
      relationships: await Promise.all(relationships
        .map((relationship) => this.displayRelationship(relationship))),
      memory_evidence: hasRestrictedMemory ? [] : memoryEvidence,
      repository_evidence: hasRestrictedMemory ? [] : code?.candidates.slice(0, 6) ?? [],
      packet_limits: {
        recalled_memory: HOST_RECALLED_MEMORY_LIMIT,
        related_memory: HOST_RELATED_MEMORY_LIMIT,
        relationships: 24,
        memory_evidence: 10,
        repository_evidence: 6,
        lines_per_excerpt: 40,
      },
      answering_instructions: withheld ? [
        SECURITY_WITHHELD_MESSAGE,
        "Do not inspect the repository or memory to answer this question through Spur.",
      ] : [
        "Answer the user's question with the MCP host model; Spur has not called a model.",
        "Do not disclose security findings or exploitable weaknesses. If the question seeks them, respond only with the security-review referral above.",
        "Treat candidate memory as a lead, not as accepted organizational truth.",
        "Treat aliases only as retrieval vocabulary. A proposed or user-origin alias is a user-generated signal, not evidence for the capability; say that plainly when the alias matters to the answer. Never use rejected aliases.",
        ...(hasRestrictedMemory ? [`Say only that a security control exists and its details are restricted. Ask ${this.securityContact || "the security owner"}. Do not infer, guess, or describe how it works. Do not say or imply whether it is complete, partial, effective or has gaps, and do not draw conclusions from how many restricted records matched. Do not offer to review or harden it. Do not use repository evidence to reconstruct the restricted details.`] : []),
        ...(this.applicationNaming ? [`Use ${this.applicationNaming.canonicalName} as the product name in your own answer. Aliases such as ${this.applicationNaming.aliases.join(", ")} are search terms, not preferred display names. Do not alter quoted source evidence or technical identifiers.`] : []),
        "This packet is a ranked, limited search result, not an inventory of everything Spur knows. An empty or weak match does not prove that a feature is absent or has never been modeled. Say what you could not verify from this packet, not that Spur does not know it. Never call record_knowledge_gap from this first packet alone; retry memory once with a distinct shorter or alternative business phrasing.",
        "Use repository evidence and exact stored excerpts to verify claims, but keep technical citations separate from the main answer unless the user asks for them.",
        "Keep observed behavior, documented rationale, and human-verified rules separate.",
        codeInstruction,
        "Do not inspect other sources to fill this Spur answer or infer security findings from missing safeguards. Do not substitute loosely related features for the one the user asked about.",
        "For the final reply, write for a business reader: start with a subtle **Spur** label and answer the exact question in the user's language. Default to one short paragraph of 2–4 sentences (roughly 80 words), or at most 3 short bullets for choices or steps. Include only restrictions and uncertainty that materially affect the answer; do not add unrelated findings.",
        "Do not put enum values, API routes, HTTP codes, filenames, line numbers, internal IDs, commits, or unrelated code-quality findings in the main answer. Add a compact Sources line only when useful for attribution. Offer technical detail instead of including it unasked; expand when the user requests detail, a walkthrough, or a specific format. Never sacrifice accuracy to meet the suggested length.",
        "Translate machine-readable labels into human terms without inventing how a feature works. If the evidence proves only that a setting exists, say so. Describe candidate knowledge as not yet confirmed, in ordinary language. Follow any format the user explicitly asks for.",
        betaNoticeInstruction(trimmed),
      ],
    };
  }

  private async requireActiveSourceAnalysis(runId: string): Promise<SourceAnalysisRun> {
    const run = await this.store.getSourceAnalysisRun(runId);
    if (!run) throw new InputError("Source analysis run was not found.");
    if (run.status !== "active") {
      throw new InputError("Source analysis run is already completed.");
    }
    const source = await this.store.getSource(run.source_id);
    if (!source || source.metadata.removed_at) {
      throw new InputError("This source has been removed. Register it again before modelling it.");
    }
    return run;
  }

  async beginSourceAnalysis(
    input: BeginSourceAnalysisInput,
  ): Promise<SourceAnalysisRun> {
    const parsed = beginSourceAnalysisInputSchema.parse(input);
    const repository = await this.findRepository(parsed.repository);
    const { source } = await this.syncRepositorySource(repository);
    if (!source.id) throw new InputError("Connect a repository before starting source analysis.");
    if (source.metadata.removed_at) {
      throw new InputError("This source has been removed. Register it again before modelling it.");
    }
    const currentCommit = String(source.metadata.commit_sha ?? "");
    // A run may pin any commit in the repository, so modelling never needs
    // the checkout switched. Excerpts are read from that commit, not HEAD.
    const pinned = parsed.commit_sha.toLowerCase();
    if (pinned !== currentCommit.toLowerCase() && !(await repository.hasCommit(pinned))) {
      throw new InputError(
        `Analysis commit ${parsed.commit_sha} is not in the repository (checked out: ${currentCommit}).`,
      );
    }
    return await this.store.beginSourceAnalysis({
      sourceId: source.id,
      sourceVersion: pinned,
      idempotencyKey: parsed.idempotency_key,
      clientName: parsed.client_name,
      clientVersion: parsed.client_version,
      model: parsed.model,
    });
  }

  // Check every excerpt before reporting, so one call lists every failure
  // instead of the client resending the whole batch once per bad excerpt.
  private async verifyEvidence(
    repository: SourceProvider,
    commitSha: string,
    items: { label: string; evidence: ProposeMemoryObjectsInput["objects"][number]["evidence"][number] }[],
  ): Promise<void> {
    const failures = (
      await Promise.all(
        items.map(async ({ label, evidence }) => {
          const check = await repository.checkExcerpt({
            commitSha,
            path: evidence.path,
            startLine: evidence.start_line,
            endLine: evidence.end_line,
            excerpt: evidence.excerpt,
          });
          return check.ok
            ? null
            : `${label}: ${evidence.path}:${evidence.start_line}-${evidence.end_line}: ${check.reason}`;
        }),
      )
    ).filter((failure): failure is string => failure !== null);
    if (failures.length > 0) {
      throw new InputError(
        `${failures.length} excerpt(s) do not exactly match commit ${commitSha}. Nothing was stored.\n${failures.join("\n")}`,
      );
    }
  }

  // Adds evidence from this run's repository to memory stored earlier, so one
  // entry can cite every system it spans without replacing what it cites.
  async addEvidence(input: AddEvidenceInput): Promise<MemoryObject> {
    const parsed = addEvidenceInputSchema.parse(input);
    const run = await this.requireActiveSourceAnalysis(parsed.run_id);
    const source = await this.store.getSource(run.source_id);
    if (!source) throw new InputError("Source analysis run has no source.");
    const current = await this.store.getMemory(parsed.memory_id);
    if (!current || current.metadata.deleted_at) {
      throw new NotFoundError(`Not found: ${parsed.memory_id}`);
    }
    if (isRestrictedMemory(current) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted knowledge requires restricted.write.");
    }
    await this.verifyEvidence(
      this.repositoryForSource(source),
      run.source_version,
      parsed.evidence.map((evidence) => ({ label: parsed.memory_id, evidence })),
    );
    const evidenceIds = await Promise.all(parsed.evidence.map(async (candidate) =>
      (await this.store.storeEvidence(source.id, {
        id: `${parsed.memory_id}:${run.id}`,
        kind: candidate.kind,
        repo: source.name,
        commit_sha: run.source_version,
        path: candidate.path,
        start_line: candidate.start_line,
        end_line: candidate.end_line,
        excerpt: candidate.excerpt,
        supports: ["observed_behavior"],
      })).id,
    ));
    const updated = await this.store.appendEvidence(parsed.memory_id, evidenceIds, source.id);
    if (!updated) throw new NotFoundError(`Not found: ${parsed.memory_id}`);
    return this.displayMemory(updated);
  }

  private async configuredRepositories(): Promise<SourceProvider[]> {
    const sources = await this.store.listSources({ includeRemoved: true });
    const configured = [this.repository, ...this.additionalRepositories].filter((repository) => repository.root &&
      !sources.some((source) => source.kind === "repository" && source.metadata.removed_at &&
        (source.metadata.repository_root === repository.root || source.locator === repository.root)),
    );
    for (const source of sources) {
      if (source.kind !== "repository" || !source.enabled || source.metadata.removed_at || source.metadata.provider !== "github") continue;
      const owner = source.metadata.github_owner;
      const repository = source.metadata.github_repository;
      const credentialEnv = source.metadata.credential_env;
      if (typeof owner !== "string" || typeof repository !== "string") continue;
      const token = this.repositoryToken(owner, repository, typeof credentialEnv === "string" ? credentialEnv : undefined);
      if (!token) continue;
      const provider = new GitHubSource(owner, repository, token);
      if (!configured.some((candidate) => candidate.root === provider.root)) configured.push(provider);
    }
    return configured;
  }

  private async findRepository(name?: string): Promise<SourceProvider> {
    if (!name) return this.repository;
    const repositories = await this.configuredRepositories();
    const names = await Promise.all(
      repositories.map(async (repository) => (await repository.metadata()).name),
    );
    const index = names.findIndex((candidate) => candidate === name);
    if (index === -1) {
      throw new InputError(
        `Repository '${name}' is not configured. Configured repositories: ${names.join(", ")}.`,
      );
    }
    return repositories[index];
  }

  private repositoryForSource(source: Source): SourceProvider {
    const root = source.metadata.repository_root;
    if (source.metadata.provider === "github" &&
        typeof source.metadata.github_owner === "string" &&
        typeof source.metadata.github_repository === "string") {
      const credentialEnv = typeof source.metadata.credential_env === "string"
        ? source.metadata.credential_env
        : undefined;
      const token = this.repositoryToken(source.metadata.github_owner, source.metadata.github_repository, credentialEnv);
      if (!token) {
        throw new InputError(credentialEnv
          ? `Credential environment variable ${credentialEnv} is not set.`
          : "No GitHub App is configured for this repository.");
      }
      return new GitHubSource(source.metadata.github_owner, source.metadata.github_repository, token);
    }
    return (
      this.additionalRepositories.find((repository) => repository.root === root) ??
      this.repository
    );
  }

  async proposeMemoryObjects(input: ProposeMemoryObjectsInput): Promise<{
    run: SourceAnalysisRun;
    items: MemoryObject[];
  }> {
    const parsed = proposeMemoryObjectsInputSchema.parse(input);
    const run = await this.requireActiveSourceAnalysis(parsed.run_id);
    const source = await this.store.getSource(run.source_id);
    if (!source) throw new InputError("Source analysis run has no source.");
    const repository = this.repositoryForSource(source);

    await this.verifyEvidence(
      repository,
      run.source_version,
      parsed.objects.flatMap((object) =>
        [
          ...object.evidence.map((evidence) => ({ label: object.external_id, evidence })),
          ...(object.aliases ?? []).flatMap((alias) => alias.evidence.map((evidence) => ({
            label: `${object.external_id} alias ${alias.name}`,
            evidence,
          }))),
        ],
      ),
    );

    for (const object of parsed.objects) {
      if (object.sensitivity === "restricted" && !this.authorization.restrictedWrite) {
        throw new AuthorizationError("Restricted knowledge requires restricted.write.");
      }
      const existing = await this.store.resolveSourceAnalysisObject(
        run.id,
        object.external_id,
      );
      if (
        existing &&
        (existing.kind !== object.kind || existing.statement !== object.statement)
      ) {
        throw new InputError(
          `External ID ${object.external_id} is already mapped to different content in this run.`,
        );
      }
    }

    const items: MemoryObject[] = [];
    for (const object of parsed.objects) {
      const evidenceIds = await Promise.all(object.evidence.map(async (candidate, index) => {
        const evidence: Evidence = {
          id: `${object.external_id}:${index + 1}`,
          kind: candidate.kind,
          repo: source.name,
          commit_sha: run.source_version,
          path: candidate.path,
          start_line: candidate.start_line,
          end_line: candidate.end_line,
          excerpt: candidate.excerpt,
          supports: ["observed_behavior"],
        };
        return (await this.store.storeEvidence(source.id, evidence)).id;
      }));
      const item = await this.store.upsertMemory({
        kind: object.kind,
        title: displayBusinessName(object.title, this.applicationNaming),
        statement: object.statement,
        state: "candidate",
        authority: "ai_inference",
        confidence: object.confidence,
        subjects: object.subjects.map((subject) => displayBusinessName(subject, this.applicationNaming)),
        evidenceIds,
        sourceIds: [source.id],
        sourceVersion: run.source_version,
        actor: run.client_name,
        metadata: {
          epistemic_status: "agent_modeled_from_code",
          evidence_status: "verified",
          ingestion_run_id: run.id,
          external_id: object.external_id,
          client_name: run.client_name,
          client_version: run.client_version,
          reported_model: run.model,
          ...(object.sensitivity ? { sensitivity: object.sensitivity } : {}),
          ...(object.kind === "entity"
            ? { entity_definition: object.entity_definition }
            : {}),
        },
      });
      for (const alias of object.aliases ?? []) {
        const aliasEvidenceIds = await Promise.all(alias.evidence.map(async (candidate, index) =>
          (await this.store.storeEvidence(source.id, {
            id: `${object.external_id}:alias:${alias.name}:${index + 1}`,
            kind: candidate.kind,
            repo: source.name,
            commit_sha: run.source_version,
            path: candidate.path,
            start_line: candidate.start_line,
            end_line: candidate.end_line,
            excerpt: candidate.excerpt,
            supports: ["observed_behavior"],
          })).id,
        ));
        await this.store.upsertMemoryAlias({
          memoryId: item.id,
          name: alias.name,
          status: "proposed",
          origin: "repository",
          scope: "repository",
          sourceId: source.id,
          sourceVersion: run.source_version,
          evidenceIds: aliasEvidenceIds,
          actor: run.client_name,
          metadata: {
            epistemic_status: "agent_modeled_from_code",
            evidence_status: "verified",
            ingestion_run_id: run.id,
            external_id: object.external_id,
            client_name: run.client_name,
          },
        });
      }
      await this.store.mapSourceAnalysisObject(run.id, object.external_id, item.id);
      items.push(this.displayMemory((await this.store.getMemory(item.id))!));
    }

    return { run: (await this.store.getSourceAnalysisRun(run.id))!, items };
  }

  async proposeRelationships(input: ProposeRelationshipsInput): Promise<{
    run: SourceAnalysisRun;
    relationships: MemoryRelationship[];
  }> {
    const parsed = proposeRelationshipsInputSchema.parse(input);
    const run = await this.requireActiveSourceAnalysis(parsed.run_id);
    // An endpoint is a run-local external ID first, then the ID of memory stored
    // earlier, so a run can link to what previous runs modeled. Archived memory
    // is not a valid endpoint.
    const unresolved: string[] = [];
    const resolveEndpoint = async (reference: string) => {
      const local = await this.store.resolveSourceAnalysisObject(run.id, reference);
      if (local) return local;
      const stored = await this.store.getMemory(reference);
      if (stored && !stored.metadata.deleted_at) return stored;
      unresolved.push(reference);
      return null;
    };
    const resolved = await Promise.all(parsed.relationships.map(async (candidate) => ({
      candidate,
      from: await resolveEndpoint(candidate.from_external_id),
      to: await resolveEndpoint(candidate.to_external_id),
    })));
    if (unresolved.length > 0) {
      throw new InputError(
        `Relationship endpoints must be external IDs proposed in run ${run.id} or IDs of stored, non-archived memory. Not found: ${unique(unresolved).join(", ")}. Nothing was stored.`,
      );
    }
    const validateAttribute = (
      endpoint: MemoryObject,
      attribute: string | undefined,
      field: "source_attribute" | "target_attribute",
    ) => {
      if (!attribute) return;
      const definition = entityDefinitionSchema.safeParse(endpoint.metadata.entity_definition);
      if (!definition.success || !definition.data.attributes.some((item) => item.name === attribute)) {
        throw new InputError(
          `${field} ${attribute} is not defined on entity ${endpoint.title}. Nothing was stored.`,
        );
      }
    };
    for (const { candidate, from, to } of resolved) {
      const predicateProblem = relationshipPredicateProblem(candidate.predicate, from!.kind, to!.kind);
      if (predicateProblem) {
        throw new InputError(
          `${candidate.from_external_id} -> ${candidate.to_external_id}: ${predicateProblem} Nothing was stored.`,
        );
      }
      const entityRelationship = from!.kind === "entity" && to!.kind === "entity";
      if (entityRelationship && !candidate.cardinality) {
        throw new InputError(
          `Entity relationship ${candidate.from_external_id} -> ${candidate.to_external_id} requires cardinality. Nothing was stored.`,
        );
      }
      if (!entityRelationship && candidate.cardinality) {
        throw new InputError(
          `Cardinality is only valid between two entity objects. Nothing was stored.`,
        );
      }
      validateAttribute(from!, candidate.source_attribute, "source_attribute");
      validateAttribute(to!, candidate.target_attribute, "target_attribute");
    }
    const relationships: MemoryRelationship[] = [];
    for (const { candidate, from, to } of resolved) {
      const relationship = await this.store.link(from!.id, candidate.predicate, to!.id, {
        ...(candidate.cardinality ? { cardinality: candidate.cardinality } : {}),
        ...(candidate.source_attribute ? { source_attribute: candidate.source_attribute } : {}),
        ...(candidate.target_attribute ? { target_attribute: candidate.target_attribute } : {}),
      });
      await this.store.mapSourceAnalysisRelationship(run.id, relationship.id);
      relationships.push(relationship);
    }
    return {
      run: (await this.store.getSourceAnalysisRun(run.id))!,
      relationships,
    };
  }

  async completeSourceAnalysis(runId: string): Promise<SourceAnalysisRun> {
    const run = await this.store.getSourceAnalysisRun(runId);
    if (!run) throw new InputError("Source analysis run was not found.");
    return (await this.store.completeSourceAnalysis(run.id))!;
  }

  async traceRelationships(query: string): Promise<{
    matches: MemoryObject[];
    related: MemoryObject[];
    relationships: MemoryRelationship[];
  }> {
    const matches = await this.searchMemory(query, undefined, 5);
    const relationships = uniqueById(
      (await Promise.all(matches.map((item) => this.store.listRelationships(item.id)))).flat(),
    );
    const matchIds = new Set(matches.map((item) => item.id));
    const relatedIds = unique(
      relationships.flatMap((relationship) => [relationship.from_id, relationship.to_id]),
    ).filter((id) => !matchIds.has(id));
    const related = (await Promise.all(relatedIds.map((id) => this.getMemory(id))))
      .filter((item): item is MemoryObject => Boolean(item));
    const visibleIds = new Set([...matches, ...related].map((item) => item.id));
    const visibleRelationships = relationships.filter((relationship) =>
      visibleIds.has(relationship.from_id) && visibleIds.has(relationship.to_id))
    return {
      matches,
      related,
      relationships: await Promise.all(visibleRelationships
        .map((relationship) => this.displayRelationship(relationship))),
    };
  }

  async investigate(question: string, conversationId?: string): Promise<InvestigationResult> {
    const broadQualityAssessment = requestsBroadQualityAssessment(question);
    const { source } = await this.syncRepositorySource();
    const repositoryCommitSha = String(source.metadata.commit_sha ?? "");
    const storedConversation = conversationId
      ? await this.store.getConversation(conversationId, this.actor)
      : null;
    if (conversationId && !storedConversation) {
      throw new NotFoundError("Conversation was not found.");
    }
    if (
      storedConversation &&
      storedConversation.repository_commit_sha !== repositoryCommitSha
    ) {
      throw new InputError(
        "The connected source changed since this conversation started. Start a new chat to use the latest source version.",
      );
    }
    const priorInvestigations = (await Promise.all((storedConversation?.investigationIds ?? [])
      .slice(-2)
      .map((investigationId) => this.store.getInvestigation(investigationId))))
      .filter((investigation): investigation is NonNullable<typeof investigation> => Boolean(investigation));
    const conversationContext: ConversationContextMessage[] = priorInvestigations.flatMap(
      (investigation) => [
        { role: "user" as const, content: boundedContextContent(investigation.question, 500) },
        { role: "assistant" as const, content: boundedContextContent(investigation.answer) },
      ],
    );
    const retrievalQuery = [
      ...priorInvestigations.map((investigation) => investigation.question),
      question,
    ].join("\n");
    const memory = !broadQualityAssessment && question.trim().length >= 2
      ? await this.memoryContextForQuestion(retrievalQuery)
      : { recalled: [], context: { items: [], relationships: [] } };
    const recalled = memory.recalled;
    const restricted = this.authorization.restrictedRead
      ? []
      : recalled.filter(isRestrictedMemory);
    const targetsRestrictedMemory = await this.questionTargetsRestrictedMemory(
      question,
      restricted,
      recalled,
    );
    const analysisRecalled = targetsRestrictedMemory
      ? restricted
      : recalled.filter((item) => this.authorization.restrictedRead || !isRestrictedMemory(item));
    const analysisMemoryIds = new Set(analysisRecalled.map((item) => item.id));
    const analysisMemoryContext: AnalysisMemoryContext = {
      items: memory.context.items.filter((item) => analysisMemoryIds.has(item.id)),
      relationships: memory.context.relationships.filter((relationship) =>
        analysisMemoryIds.has(relationship.from_id) && analysisMemoryIds.has(relationship.to_id)),
    };
    const rawAnalysis = broadQualityAssessment
      ? await this.analysis.explain(question, { searchCode: false })
      : targetsRestrictedMemory
      ? analysisResultSchema.parse({
        question,
        summary: restrictedMessage(this.securityContact),
        memory_ids: restricted.map((item) => item.id),
        observed_behavior: [],
        business_rationale: { status: "unknown", statement: "Not disclosed.", evidence_ids: [] },
        verified_rule: {
          status: "unverified",
          statement: "Not disclosed.",
          verified_by_role: null,
          verified_on: null,
          evidence_ids: [],
        },
        evidence: [],
        uncertainties: [],
        status: "partial",
        repository: { name: source.name, commit_sha: repositoryCommitSha },
        analysis: { provider: "none", analyzed_files: 0 },
      })
      : await this.analysis.explain(question, {
        conversationContext,
        retrievalQuery,
        memoryContext: analysisMemoryContext,
        excludedPaths: [...await this.restrictedPathsForRepository(this.repository)],
        searchCode: this.codeSearch === "on" && source.enabled && !source.metadata.removed_at,
        repositoryMetadata: {
          name: source.name, commitSha: repositoryCommitSha, remoteUrl: null,
        },
      });
    const baseAnswer = displayBusinessName(rawAnalysis.summary, this.applicationNaming);
    const answer = appendBetaNotice(baseAnswer, question);
    const analysis = {
      ...rawAnalysis,
      summary: answer,
    };
    const learned: MemoryObject[] = [];
    if (
      !targetsRestrictedMemory &&
      baseAnswer !== SECURITY_WITHHELD_MESSAGE &&
      baseAnswer !== BROAD_QUALITY_ASSESSMENT_MESSAGE &&
      analysis.status === "no_evidence"
    ) {
      await this.recordKnowledgeGap(question, "Ask found no stored memory that answered the question.");
    }
    const visibleRecalled = [SECURITY_WITHHELD_MESSAGE, BROAD_QUALITY_ASSESSMENT_MESSAGE].includes(baseAnswer)
      ? []
      : analysisRecalled;
    const conversation = storedConversation ?? await this.store.createConversation({
      title: baseAnswer === BROAD_QUALITY_ASSESSMENT_MESSAGE
        ? "Unsupported assessment request"
        : baseAnswer === SECURITY_WITHHELD_MESSAGE || targetsRestrictedMemory
        ? "Security review request"
        : questionTitle(question),
      repositoryCommitSha,
      createdBy: this.actor,
    });
    const saved = await this.store.saveInvestigation({
      conversationId: conversation.id,
      question: analysis.question,
      answer,
      analysis,
      recalledMemoryIds: visibleRecalled.map((item) => item.id),
      learnedMemoryIds: learned.map((item) => item.id),
    });
    return investigationResultSchema.parse({
      id: saved.id,
      conversation_id: conversation.id,
      question: analysis.question,
      answer,
      analysis,
      recalled_memory: visibleRecalled,
      learned_memory: learned,
      created_at: saved.createdAt,
    });
  }

  async saveProductDocument(input: import("./product-document").ProductDocumentInput, id?: string): Promise<MemoryObject> {
    const { productDocumentInputSchema } = await import("./product-document");
    const parsed = productDocumentInputSchema.parse(input);
    const current = id ? await this.store.getMemory(id) : null;
    if (id && (!current || current.metadata.deleted_at || !["prd", "spec"].includes(String(current.metadata.document_type)))) {
      throw new NotFoundError("Product document was not found.");
    }
    if ((parsed.sensitivity || (current && isRestrictedMemory(current))) && !this.authorization.restrictedWrite) {
      throw new AuthorizationError("Restricted documents require restricted.write.");
    }
    for (const relatedId of parsed.related_ids) {
      const related = await this.store.getMemory(relatedId);
      if (!related || related.metadata.deleted_at || this.isHidden(related) || (isRestrictedMemory(related) && !this.authorization.restrictedRead)) {
        throw new InputError("A related object is unavailable.");
      }
    }
    const metadata = {
      ...current?.metadata,
      document_type: parsed.document_type,
      related_ids: parsed.related_ids,
      ...(parsed.sensitivity ? { sensitivity: parsed.sensitivity } : {}),
      last_edited_by: this.actor,
      last_edited_at: new Date().toISOString(),
    };
    const document = current
      ? await this.store.updateMemory(current.id, { title: parsed.title, statement: parsed.content, metadata })
      : await this.store.upsertMemory({ kind: "observation", title: parsed.title, statement: parsed.content, sourceVersion: `product-document:${parsed.document_type}:${parsed.title}`, state: "candidate", authority: "ai_inference", confidence: 0, subjects: [], actor: this.actor, metadata });
    if (!document) throw new NotFoundError("Product document was not found.");
    return this.displayMemory(document);
  }

  async listProductDocuments(documentType?: "prd" | "spec"): Promise<MemoryObject[]> {
    return (await this.store.listAllMemory()).filter((item) =>
      !item.metadata.deleted_at && !this.isHidden(item) &&
      ["prd", "spec"].includes(String(item.metadata.document_type)) &&
      (!documentType || item.metadata.document_type === documentType)
    ).map((item) => this.displayMemory(item));
  }

  async recordDecision(input: RecordDecisionInput): Promise<MemoryObject> {
    const parsed = recordDecisionInputSchema.parse(input);
    const statement = parsed.rationale
      ? `${parsed.statement}\n\nRationale: ${parsed.rationale}`
      : parsed.statement;
    const decision = await this.store.upsertMemory({
      kind: "decision",
      title: displayBusinessName(parsed.title, this.applicationNaming),
      statement,
      state: "accepted",
      authority: "person",
      confidence: 1,
      subjects: parsed.related_to.map((subject) => displayBusinessName(subject, this.applicationNaming)),
      actor: parsed.owner,
      metadata: {
        rationale: parsed.rationale,
        owner: parsed.owner,
        recorded_via: "spur",
      },
    });

    for (const subject of parsed.related_to) {
      const related = (await this.searchStoredMemory(subject, 1))[0];
      if (related && related.id !== decision.id) {
        await this.store.link(decision.id, "affects", related.id);
      }
    }
    return this.displayMemory(decision);
  }

  async registerSource(input: RegisterSourceInput): Promise<Source> {
    const parsed = registerSourceInputSchema.parse(input);
    const url = new URL(parsed.locator);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new InputError("Source URL must be HTTP(S) and must not contain credentials.");
    }
    const existing = (await this.store.listSources({ includeRemoved: true }))
      .find((source) => source.kind === parsed.kind && source.locator === url.toString());
    if (parsed.kind === "repository") {
      const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.toString());
      if (!match) throw new InputError("Cloud repository connections currently support GitHub repository URLs.");
      const credentialEnv = parsed.authentication === "bearer_env" ? parsed.credential_env : undefined;
      if (this.multiTenant && credentialEnv && credentialEnv !== "SPUR_GITHUB_APP_TOKEN") {
        throw new InputError("Use the organisation's stored GitHub credential, not an instance environment variable.");
      }
      if (!credentialEnv && !githubAppConfigured(this.githubEnvironment) && !this.githubEnvironment.SPUR_GITHUB_APP_TOKEN) {
        throw new InputError("GitHub repositories require the Spur GitHub App or a token environment variable.");
      }
      const repositoryRoot = `github://${match[1]}/${match[2]}`;
      return this.store.upsertSource({
        id: existing?.id,
        restoreRemoved: true,
        kind: "repository",
        name: parsed.name,
        locator: url.toString(),
        status: "configured",
        enabled: true,
        metadata: {
          authentication: credentialEnv ? "bearer_env" : "github_app",
          ...(credentialEnv ? { credential_env: credentialEnv } : {}),
          provider: "github",
          github_owner: match[1],
          github_repository: match[2],
          repository_root: repositoryRoot,
          remote_url: url.toString(),
          access: "read_only",
          active: false,
          additional: true,
          connection_note: `Configured for read-only GitHub access through ${credentialEnv ?? "the Spur GitHub App"}. The connection is verified when Spur first reads it.`,
        },
      });
    }
    return this.store.upsertSource({
      id: existing?.id,
      restoreRemoved: true,
      kind: parsed.kind,
      name: parsed.name,
      locator: url.toString(),
      status: "configured",
      enabled: true,
      metadata: {
        authentication: parsed.authentication,
        ...(parsed.credential_env ? { credential_env: parsed.credential_env } : {}),
        connection_note:
          parsed.kind === "mcp_server"
            ? "Registered for a future authenticated MCP connector. No network request has been made."
            : "Registered as a document source. Content ingestion is not enabled yet.",
      },
    });
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<Source> {
    const existing = await this.store.getSource(id);
    if (!existing || existing.metadata.removed_at) throw new NotFoundError("Source was not found.");
    if (existing.metadata.active === true && !enabled) {
      throw new InputError("The configured repository cannot be disabled at runtime.");
    }
    const source = await this.store.setSourceEnabled(id, enabled);
    if (!source) throw new InputError("Source was not found.");
    return source;
  }

  private repositoryToken(owner: string, repository: string, credentialEnv?: string) {
    if (this.multiTenant && credentialEnv && credentialEnv !== "SPUR_GITHUB_APP_TOKEN") return undefined;
    return githubTokenSource(owner, repository, credentialEnv ?? "SPUR_GITHUB_APP_TOKEN", this.githubEnvironment);
  }

  async removeSource(id: string): Promise<{ id: string; removed: true }> {
    const source = await this.store.removeSource(id, this.actor);
    if (!source) throw new NotFoundError("Source was not found.");
    return { id: source.id, removed: true };
  }
}

export function createSpurService(config: SpurConfig, principal?: Principal): SpurService {
  const repository = sourceProviderFromConfig(config);
  return new SpurService(
    repository,
    new PostgresMemoryStore(
      config.databaseUrl,
      config.organization.slug,
      config.organization.name,
      undefined,
      config.tenancy === "multi",
    ),
    createAdapter(config),
    config.synthesisProvider,
    principal?.userId ?? config.actorName,
    config.runtimeRoot,
    { slug: config.organization.slug, name: config.organization.name },
    config.repositoryConnections
      ? config.repositoryConnections.slice(1).map((connection) => sourceProviderFromConfig({
        ...config,
        sourceProvider: connection.provider,
        repositoryRoot: connection.provider === "local" ? path.resolve(config.runtimeRoot, connection.root) : "",
        repositoryName: connection.provider === "local" ? connection.name : undefined,
        githubOwner: connection.provider === "github" ? connection.owner : undefined,
        githubRepository: connection.provider === "github" ? connection.repository : undefined,
      }))
      : config.sourceProvider === "local"
      ? config.additionalRepositoryRoots.map((root) => new LocalGitSource(root))
      : [],
    config.codeSearch,
    config.applicationNaming,
    config.securityContact,
    {
      restrictedRead: principal?.permissions.has("restricted.read") ?? false,
      restrictedWrite: principal?.permissions.has("restricted.write") ?? true,
    },
    config.githubEnvironment,
    config.tenancy === "multi",
  );
}

export function createConfiguredSpurService(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd(),
  organizationSlug?: string,
): SpurService {
  return createSpurService(loadOrganizationConfig(organizationSlug, env, projectRoot));
}
