import type { FeatureName } from "./features";

export const PERMISSIONS = [
  "memory.read",
  "memory.ask",
  "memory.propose",
  "memory.edit",
  "memory.add_evidence",
  "memory.relate",
  "memory.promote",
  "memory.archive",
  "memory.merge",
  "restricted.read",
  "restricted.write",
  "isms.read",
  "isms.propose",
  "isms.approve",
  "isms.archive",
  "code_search.run",
  "knowledge_gaps.read",
  "knowledge_gaps.write",
  "decisions.record",
  "conversations.read",
  "wiki.read",
  "wiki.export",
  "sources.manage",
  "users.manage",
  "roles.manage",
  "features.manage",
  "audit.read",
  "mcp.connect",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  reader: [
    "memory.read", "memory.ask", "isms.read", "knowledge_gaps.read",
    "conversations.read", "wiki.read", "wiki.export", "mcp.connect",
  ],
  modeller: [
    "memory.read", "memory.ask", "memory.propose", "memory.edit",
    "memory.add_evidence", "memory.relate", "code_search.run",
    "knowledge_gaps.read", "knowledge_gaps.write", "decisions.record",
    "conversations.read", "isms.read", "wiki.read", "wiki.export", "mcp.connect",
  ],
  reviewer: [
    "memory.read", "memory.ask", "memory.propose", "memory.edit",
    "memory.add_evidence", "memory.relate", "memory.promote", "memory.archive",
    "memory.merge", "code_search.run", "knowledge_gaps.read", "knowledge_gaps.write",
    "decisions.record", "conversations.read", "isms.read", "isms.propose",
    "isms.approve", "isms.archive", "wiki.read", "wiki.export", "mcp.connect",
  ],
  "security-owner": [
    "memory.read", "memory.ask", "memory.propose", "memory.edit",
    "memory.add_evidence", "memory.relate", "memory.promote", "memory.archive",
    "memory.merge", "restricted.read", "restricted.write", "code_search.run",
    "knowledge_gaps.read", "knowledge_gaps.write", "decisions.record",
    "conversations.read", "isms.read", "isms.propose", "isms.approve", "isms.archive",
    "wiki.read", "wiki.export", "mcp.connect",
  ],
  administrator: PERMISSIONS.filter((permission) =>
    permission !== "restricted.read" && permission !== "restricted.write"),
};

export const SYSTEM_ROLE_DESCRIPTIONS: Record<string, string> = {
  reader: "Read and ask questions about organisation knowledge.",
  modeller: "Model knowledge and attach verified evidence.",
  reviewer: "Review, govern and approve model and ISMS changes.",
  "security-owner": "Review restricted security details and manage restricted knowledge.",
  administrator: "Manage users, roles, features and all organisation data.",
};

export const MCP_TOOL_PERMISSIONS = {
  list_isms_controls: "isms.read",
  search_isms_controls: "isms.read",
  get_isms_control: "isms.read",
  propose_isms_control: "isms.propose",
  edit_isms_control: "isms.propose",
  approve_isms_control: "isms.approve",
  archive_isms_control: "isms.archive",
  get_modeling_schema: "memory.read",
  begin_source_analysis: "memory.propose",
  propose_memory_objects: "memory.propose",
  propose_memory_alias: "memory.propose",
  review_memory_alias: "memory.promote",
  propose_relationships: "memory.relate",
  add_evidence: "memory.add_evidence",
  complete_source_analysis: "memory.propose",
  explain_business_rule: "memory.ask",
  investigate: "memory.ask",
  search_repository: "code_search.run",
  record_knowledge_gap: "knowledge_gaps.write",
  list_knowledge_gaps: "knowledge_gaps.read",
  resolve_knowledge_gap: "knowledge_gaps.write",
  reopen_knowledge_gap: "knowledge_gaps.write",
  search_memory: "memory.read",
  get_memory: "memory.read",
  edit_memory: "memory.edit",
  promote_memory: "memory.promote",
  merge_memory: "memory.merge",
  archive_memory: "memory.archive",
  trace_relationships: "memory.read",
  record_decision: "decisions.record",
  create_product_document: "memory.propose",
  update_product_document: "memory.edit",
  list_product_documents: "memory.read",
  get_product_document: "memory.read",
} as const satisfies Record<string, Permission>;

export type McpToolName = keyof typeof MCP_TOOL_PERMISSIONS;

export const API_ROUTE_PERMISSIONS = {
  "GET /.well-known/oauth-authorization-server": "public",
  "GET /.well-known/oauth-protected-resource": "public",
  "GET /oauth/authorize": "authenticated",
  "POST /oauth/authorize": "authenticated",
  "POST /oauth/register": "public",
  "POST /oauth/token": "public",
  "POST /oauth/revoke": "public",
  "GET /mcp": "mcp.connect",
  "POST /mcp": "mcp.connect",
  "DELETE /mcp": "mcp.connect",
  "GET /healthz": "public",
  "POST /api/analyze": "memory.ask",
  "GET /api/conversations": "conversations.read",
  "POST /api/investigate": "memory.ask",
  "GET /api/isms/controls": "isms.read",
  "POST /api/isms/controls": "isms.propose",
  "GET /api/isms/controls/:id": "isms.read",
  "PATCH /api/isms/controls/:id": "authenticated",
  "GET /api/knowledge-gaps": "knowledge_gaps.read",
  "PATCH /api/knowledge-gaps/:id": "knowledge_gaps.write",
  "POST /api/memory/:id/merge": "memory.merge",
  "POST /api/memory/:id/aliases": "memory.propose",
  "PATCH /api/memory/:id/aliases": "memory.promote",
  "GET /api/memory/:id": "memory.read",
  "PATCH /api/memory/:id": "authenticated",
  "GET /api/memory": "memory.read",
  "POST /api/memory": "decisions.record",
  "GET /api/organizations": "public",
  "GET /api/instance/organizations": "authenticated",
  "POST /api/instance/organizations": "authenticated",
  "PATCH /api/instance/organizations/:slug": "authenticated",
  "GET /api/repository": "memory.read",
  "POST /api/sources": "sources.manage",
  "PATCH /api/sources": "sources.manage",
  "DELETE /api/sources": "sources.manage",
  "GET /api/workspace": "memory.read",
  "GET /api/wiki": "wiki.read",
  "GET /api/auth/google": "public",
  "GET /api/auth/google/callback": "public",
  "POST /api/auth/otp/request": "public",
  "POST /api/auth/otp/verify": "public",
  "POST /api/auth/logout": "authenticated",
  "GET /api/auth/session": "authenticated",
  "GET /api/admin/access-requests": "users.manage",
  "PATCH /api/admin/access-requests/:id": "users.manage",
  "GET /api/admin/roles": "roles.manage",
  "POST /api/admin/roles": "roles.manage",
  "PATCH /api/admin/roles/:id": "roles.manage",
  "DELETE /api/admin/roles/:id": "roles.manage",
  "PATCH /api/admin/users/:id": "users.manage",
  "GET /api/admin/features": "features.manage",
  "PATCH /api/admin/features": "features.manage",
  "GET /api/admin/mcp-tokens": "users.manage",
  "DELETE /api/admin/mcp-tokens/:id": "users.manage",
} as const satisfies Record<string, Permission | "authenticated" | "public">;

export const PAGE_ROUTE_PERMISSIONS = {
  "/": "public",
  "/ask": "public",
  "/guide": "public",
  "/memory": "public",
  "/model": "public",
  "/model/catalog": "public",
  "/model/catalog/:id": "public",
  "/model/composition": "public",
  "/model/gaps": "public",
  "/model/health": "public",
  "/sources": "public",
  "/organizations": "authenticated",
  "/admin/organizations": "authenticated",
  "/o/:organization/guide": "memory.read",
  "/o/:organization/ask": "memory.ask",
  "/o/:organization/model": "memory.read",
  "/o/:organization/model/catalog": "memory.read",
  "/o/:organization/model/catalog/:id": "memory.read",
  "/o/:organization/model/health": "memory.read",
  "/o/:organization/model/gaps": "knowledge_gaps.read",
  "/o/:organization/sources": "sources.manage",
  "/o/:organization/isms/controls": "isms.read",
  "/o/:organization/wiki": "wiki.read",
  "/o/:organization/wiki/:id": "wiki.read",
  "/o/:organization/admin": "users.manage",
  "/access/pending": "authenticated",
} as const satisfies Record<string, Permission | "authenticated" | "public">;

export type RouteAccess = Permission | "authenticated" | "public";

export const API_ROUTE_FEATURES = {
  "GET /.well-known/oauth-authorization-server": [],
  "GET /.well-known/oauth-protected-resource": [],
  "GET /oauth/authorize": ["remote_mcp"],
  "POST /oauth/authorize": ["remote_mcp"],
  "POST /oauth/register": [],
  "POST /oauth/token": [],
  "POST /oauth/revoke": [],
  "GET /mcp": ["remote_mcp"],
  "POST /mcp": ["remote_mcp"],
  "DELETE /mcp": ["remote_mcp"],
  "GET /healthz": [],
  "POST /api/analyze": ["ask"],
  "GET /api/conversations": ["ask"],
  "POST /api/investigate": ["ask"],
  "GET /api/isms/controls": ["isms"],
  "POST /api/isms/controls": ["isms"],
  "GET /api/isms/controls/:id": ["isms"],
  "PATCH /api/isms/controls/:id": ["isms"],
  "GET /api/knowledge-gaps": ["knowledge_gaps"],
  "PATCH /api/knowledge-gaps/:id": ["knowledge_gaps"],
  "POST /api/memory/:id/merge": [],
  "POST /api/memory/:id/aliases": ["modelling_writes"],
  "PATCH /api/memory/:id/aliases": [],
  "GET /api/memory/:id": [],
  "PATCH /api/memory/:id": ["modelling_writes"],
  "GET /api/memory": [],
  "POST /api/memory": [],
  "GET /api/organizations": [],
  "GET /api/instance/organizations": [],
  "POST /api/instance/organizations": [],
  "PATCH /api/instance/organizations/:slug": [],
  "GET /api/repository": [],
  "POST /api/sources": [],
  "PATCH /api/sources": [],
  "DELETE /api/sources": [],
  "GET /api/workspace": [],
  "GET /api/wiki": ["wiki"],
  "GET /api/auth/google": [],
  "GET /api/auth/google/callback": [],
  "POST /api/auth/otp/request": [],
  "POST /api/auth/otp/verify": [],
  "POST /api/auth/logout": [],
  "GET /api/auth/session": [],
  "GET /api/admin/access-requests": [],
  "PATCH /api/admin/access-requests/:id": [],
  "GET /api/admin/roles": [],
  "POST /api/admin/roles": [],
  "PATCH /api/admin/roles/:id": [],
  "DELETE /api/admin/roles/:id": [],
  "PATCH /api/admin/users/:id": [],
  "GET /api/admin/features": [],
  "PATCH /api/admin/features": [],
  "GET /api/admin/mcp-tokens": [],
  "DELETE /api/admin/mcp-tokens/:id": [],
} as const satisfies { [K in keyof typeof API_ROUTE_PERMISSIONS]: readonly FeatureName[] };

export const PAGE_ROUTE_FEATURES = {
  "/": [],
  "/ask": [],
  "/guide": [],
  "/memory": [],
  "/model": [],
  "/model/catalog": [],
  "/model/catalog/:id": [],
  "/model/composition": [],
  "/model/gaps": [],
  "/model/health": [],
  "/sources": [],
  "/organizations": [],
  "/admin/organizations": [],
  "/o/:organization/guide": [],
  "/o/:organization/ask": ["ask"],
  "/o/:organization/model": [],
  "/o/:organization/model/catalog": [],
  "/o/:organization/model/catalog/:id": [],
  "/o/:organization/model/health": [],
  "/o/:organization/model/gaps": ["knowledge_gaps"],
  "/o/:organization/sources": [],
  "/o/:organization/isms/controls": ["isms"],
  "/o/:organization/wiki": ["wiki"],
  "/o/:organization/wiki/:id": ["wiki"],
  "/o/:organization/admin": [],
  "/access/pending": [],
} as const satisfies { [K in keyof typeof PAGE_ROUTE_PERMISSIONS]: readonly FeatureName[] };

export const MCP_TOOL_FEATURES = {
  list_isms_controls: ["isms"],
  search_isms_controls: ["isms"],
  get_isms_control: ["isms"],
  propose_isms_control: ["isms"],
  edit_isms_control: ["isms"],
  approve_isms_control: ["isms"],
  archive_isms_control: ["isms"],
  get_modeling_schema: [],
  begin_source_analysis: ["modelling_writes"],
  propose_memory_objects: ["modelling_writes"],
  propose_memory_alias: ["modelling_writes"],
  review_memory_alias: [],
  propose_relationships: ["modelling_writes"],
  add_evidence: ["modelling_writes"],
  complete_source_analysis: ["modelling_writes"],
  explain_business_rule: ["ask"],
  investigate: ["ask"],
  search_repository: ["code_search"],
  record_knowledge_gap: ["knowledge_gaps"],
  list_knowledge_gaps: ["knowledge_gaps"],
  resolve_knowledge_gap: ["knowledge_gaps"],
  reopen_knowledge_gap: ["knowledge_gaps"],
  search_memory: [],
  get_memory: [],
  edit_memory: ["modelling_writes"],
  promote_memory: [],
  merge_memory: [],
  archive_memory: [],
  trace_relationships: [],
  record_decision: [],
  create_product_document: ["modelling_writes"],
  update_product_document: ["modelling_writes"],
  list_product_documents: [],
  get_product_document: [],
} as const satisfies { [K in McpToolName]: readonly FeatureName[] };

export function normalizeApiPath(pathname: string): string {
  return pathname
    .replace(/^\/api\/instance\/organizations\/[^/]+$/, "/api/instance/organizations/:slug")
    .replace(/^\/api\/knowledge-gaps\/[^/]+$/, "/api/knowledge-gaps/:id")
    .replace(/^\/api\/isms\/controls\/[^/]+$/, "/api/isms/controls/:id")
    .replace(/^\/api\/memory\/[^/]+\/merge$/, "/api/memory/:id/merge")
    .replace(/^\/api\/memory\/[^/]+\/aliases$/, "/api/memory/:id/aliases")
    .replace(/^\/api\/memory\/[^/]+$/, "/api/memory/:id")
    .replace(/^\/api\/admin\/access-requests\/[^/]+$/, "/api/admin/access-requests/:id")
    .replace(/^\/api\/admin\/roles\/[^/]+$/, "/api/admin/roles/:id")
    .replace(/^\/api\/admin\/users\/[^/]+$/, "/api/admin/users/:id")
    .replace(/^\/api\/admin\/mcp-tokens\/[^/]+$/, "/api/admin/mcp-tokens/:id");
}

export function routeAccess(method: string, pathname: string): RouteAccess {
  const key = `${method.toUpperCase()} ${normalizeApiPath(pathname)}` as keyof typeof API_ROUTE_PERMISSIONS;
  const access = API_ROUTE_PERMISSIONS[key];
  if (!access) throw new Error(`API route ${key} has no declared permission.`);
  return access;
}

export function apiRouteFeatures(method: string, pathname: string): readonly FeatureName[] {
  const key = `${method.toUpperCase()} ${normalizeApiPath(pathname)}` as keyof typeof API_ROUTE_FEATURES;
  const required = API_ROUTE_FEATURES[key];
  if (!required) throw new Error(`API route ${key} has no declared feature requirements.`);
  return required;
}

export function normalizePagePath(pathname: string): string {
  return pathname
    .replace(/^\/model\/catalog\/[^/]+$/, "/model/catalog/:id")
    .replace(/^\/o\/[^/]+\/model\/catalog\/[^/]+$/, "/o/:organization/model/catalog/:id")
    .replace(/^\/o\/[^/]+\/wiki\/[^/]+$/, "/o/:organization/wiki/:id")
    .replace(/^\/o\/[^/]+\//, "/o/:organization/");
}

export function pageAccess(pathname: string): RouteAccess {
  const normalized = normalizePagePath(pathname) as keyof typeof PAGE_ROUTE_PERMISSIONS;
  const access = PAGE_ROUTE_PERMISSIONS[normalized];
  if (!access) throw new Error(`Page route ${normalized} has no declared permission.`);
  return access;
}

export function pageRouteFeatures(pathname: string): readonly FeatureName[] {
  const normalized = normalizePagePath(pathname) as keyof typeof PAGE_ROUTE_FEATURES;
  const required = PAGE_ROUTE_FEATURES[normalized];
  if (!required) throw new Error(`Page route ${normalized} has no declared feature requirements.`);
  return required;
}

export function hasPermission(permissions: ReadonlySet<Permission>, permission: Permission): boolean {
  return permissions.has(permission);
}
