"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type AccessRequest = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  requested_at: string;
  role_ids: string[];
};

type Role = {
  id: string;
  name: string;
  description: string;
  system: boolean;
  permissions: string[];
};

type Features = {
  ask: boolean;
  code_search: "off" | "ask" | "on";
  model_provider: "none" | "anthropic" | "openai";
  modelling_writes: boolean;
  isms: boolean;
  wiki: boolean;
  remote_mcp: boolean;
  knowledge_gaps: boolean;
};

type McpGrant = {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  clientId: string;
  clientName: string;
  authorizedAt: string;
  lastRenewedAt: string;
  refreshExpiresAt: string;
  status: "active" | "expired" | "revoked";
  revokedAt: string | null;
};

const FEATURE_LABELS: Record<keyof Features, string> = {
  ask: "Ask",
  code_search: "Code search",
  model_provider: "Model provider",
  modelling_writes: "Modelling writes",
  isms: "ISMS register",
  wiki: "Wiki",
  remote_mcp: "Remote MCP",
  knowledge_gaps: "Knowledge gaps",
};

const ADMIN_TABS = [
  { id: "features", label: "Features" },
  { id: "people", label: "People" },
  { id: "mcp", label: "Remote MCP" },
  { id: "roles", label: "Roles" },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]["id"];

function message(payload: unknown, fallback: string): string {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function AdminAccess({ organizationId }: { organizationId: string }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("features");
  const [roleEditorOpen, setRoleEditorOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [features, setFeatures] = useState<Features | null>(null);
  const [mcpGrants, setMcpGrants] = useState<McpGrant[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string[]>>({});
  const [selectedPermission, setSelectedPermission] = useState<Record<string, string>>({});
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const headers = useCallback((json = false): HeadersInit => ({
    "x-spur-organization": organizationId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  }), [organizationId]);

  const refresh = useCallback(async () => {
    const [requestsResponse, rolesResponse, featuresResponse, tokensResponse] = await Promise.all([
      fetch("/api/admin/access-requests", { cache: "no-store", headers: headers() }),
      fetch("/api/admin/roles", { cache: "no-store", headers: headers() }),
      fetch("/api/admin/features", { cache: "no-store", headers: headers() }),
      fetch("/api/admin/mcp-tokens", { cache: "no-store", headers: headers() }),
    ]);
    const requestsPayload = await requestsResponse.json() as { access_requests?: AccessRequest[]; error?: string };
    const rolesPayload = await rolesResponse.json() as { roles?: Role[]; permissions?: string[]; error?: string };
    const featuresPayload = await featuresResponse.json() as { features?: Features; error?: string };
    const tokensPayload = await tokensResponse.json() as { grants?: McpGrant[]; error?: string };
    if (!requestsResponse.ok) throw new Error(message(requestsPayload, "Access requests could not be loaded."));
    if (!rolesResponse.ok) throw new Error(message(rolesPayload, "Roles could not be loaded."));
    if (!featuresResponse.ok) throw new Error(message(featuresPayload, "Features could not be loaded."));
    if (!tokensResponse.ok) throw new Error(message(tokensPayload, "MCP tokens could not be loaded."));
    const nextRequests = requestsPayload.access_requests ?? [];
    setRequests(nextRequests);
    setRoles(rolesPayload.roles ?? []);
    setPermissions(rolesPayload.permissions ?? []);
    setFeatures(featuresPayload.features ?? null);
    setMcpGrants(tokensPayload.grants ?? []);
    setSelectedRoles(Object.fromEntries(nextRequests.map((item) => [item.user_id, item.role_ids])));
  }, [headers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refresh().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Administration data could not be loaded."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function decide(item: AccessRequest, decision: "approved" | "rejected") {
    setBusy(`decision:${item.id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/access-requests/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ decision, role_ids: decision === "approved" ? selectedRoles[item.user_id] ?? [] : [] }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "The access request could not be updated."));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The access request could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function updateUser(userId: string, body: Record<string, unknown>) {
    setBusy(`user:${userId}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "The user could not be updated."));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The user could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault();
    setBusy("role:new");
    setError("");
    try {
      const response = await fetch(editingRoleId
        ? `/api/admin/roles/${encodeURIComponent(editingRoleId)}`
        : "/api/admin/roles", {
        method: editingRoleId ? "PATCH" : "POST",
        headers: headers(true),
        body: JSON.stringify({ name: roleName, description: roleDescription, permissions: rolePermissions }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(message(payload, "The role could not be saved."));
      setRoleName("");
      setRoleDescription("");
      setRolePermissions([]);
      setEditingRoleId("");
      setRoleEditorOpen(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The role could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function deleteRole(role: Role) {
    setBusy(`role:${role.id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/roles/${encodeURIComponent(role.id)}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        throw new Error(message(payload, "The role could not be deleted."));
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The role could not be deleted.");
    } finally {
      setBusy("");
    }
  }

  async function updateFeature(name: keyof Features, value: Features[keyof Features]) {
    setBusy(`feature:${name}`);
    setError("");
    try {
      const response = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ feature: name, value }),
      });
      const payload = await response.json() as { features?: Features; error?: string };
      if (!response.ok || !payload.features) throw new Error(message(payload, "The feature could not be updated."));
      setFeatures(payload.features);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The feature could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function revokeMcpGrant(id: string) {
    setBusy(`mcp-grant:${id}`);
    setError("");
    try {
      const response = await fetch(`/api/admin/mcp-tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        throw new Error(message(payload, "The MCP connection could not be revoked."));
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The MCP connection could not be revoked.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8">
      <div className="border-b pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">Organisation administration</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Access and roles</h1>
        <p className="mt-2 text-sm text-muted-foreground">Approve access by permission bundle, create custom roles, and apply individual permission overrides.</p>
      </div>

      {error ? <Alert variant="destructive" className="mt-6"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div role="tablist" aria-label="Administration" className="-mx-5 mt-4 flex snap-x gap-6 overflow-x-auto overscroll-x-contain border-b px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
        {ADMIN_TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`admin-tab-${tab.id}`}
            aria-controls={`admin-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              const nextIndex = event.key === "ArrowRight" ? (index + 1) % ADMIN_TABS.length
                : event.key === "ArrowLeft" ? (index + ADMIN_TABS.length - 1) % ADMIN_TABS.length
                  : event.key === "Home" ? 0 : event.key === "End" ? ADMIN_TABS.length - 1 : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const next = ADMIN_TABS[nextIndex];
              setActiveTab(next.id);
              document.getElementById(`admin-tab-${next.id}`)?.focus();
            }}
            className={`shrink-0 snap-start border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab.label}
            {tab.id === "people" && requests.some((request) => request.status === "pending") ? (
              <Badge variant="secondary" className="ml-2">{requests.filter((request) => request.status === "pending").length}</Badge>
            ) : null}
          </button>
        ))}
      </div>

      <section role="tabpanel" id="admin-panel-features" aria-labelledby="admin-tab-features" hidden={activeTab !== "features"} className="py-7">
        <h2 className="text-lg font-semibold">Features</h2>
        <p className="mt-1 text-sm text-muted-foreground">Database settings override environment defaults for this organisation.</p>
        {features ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(FEATURE_LABELS) as Array<keyof Features>).map((name) => (
            <label key={name} className="rounded-md border p-3 text-sm">
              <span className="font-medium">{FEATURE_LABELS[name]}</span>
              {name === "code_search" ? (
                <select className="mt-2 h-9 w-full rounded-md border bg-background px-2" value={features.code_search} disabled={busy !== ""} onChange={(event) => void updateFeature(name, event.target.value as Features["code_search"])}><option value="off">Off</option><option value="ask">Ask</option><option value="on">On</option></select>
              ) : name === "model_provider" ? (
                <select className="mt-2 h-9 w-full rounded-md border bg-background px-2" value={features.model_provider} disabled={busy !== ""} onChange={(event) => void updateFeature(name, event.target.value as Features["model_provider"])}><option value="none">None</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
              ) : (
                <span className="mt-3 flex items-center gap-2"><input type="checkbox" checked={features[name] as boolean} disabled={busy !== ""} onChange={(event) => void updateFeature(name, event.target.checked)} />Enabled</span>
              )}
            </label>
          ))}
        </div> : <p className="mt-4 text-sm text-muted-foreground">Loading feature settings…</p>}
      </section>

      <section role="tabpanel" id="admin-panel-people" aria-labelledby="admin-tab-people" hidden={activeTab !== "people"} className="py-7">
        <h2 className="text-lg font-semibold">People <span className="ml-2 text-sm font-normal text-muted-foreground">{requests.length}</span></h2>
        <p className="mt-1 text-sm text-muted-foreground">Review access requests and manage each person’s roles and permissions.</p>
        <div className="mt-4 border-y">
          <Table aria-label="Organisation users">
            <TableHeader><TableRow>
              <TableHead scope="col">User</TableHead>
              <TableHead scope="col" className="hidden sm:table-cell">Status</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">Roles</TableHead>
              <TableHead scope="col" className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {requests.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="min-w-0 whitespace-normal py-5"><span className="block font-medium">{item.display_name}</span><span className="mt-1 block break-all text-xs text-muted-foreground">{item.email}</span><Badge variant={item.status === "approved" ? "secondary" : "outline"} className="mt-2 sm:hidden">{item.status}</Badge></TableCell>
                  <TableCell className="hidden align-middle sm:table-cell"><Badge variant={item.status === "approved" ? "secondary" : "outline"}>{item.status}</Badge></TableCell>
                  <TableCell className="hidden max-w-sm whitespace-normal align-middle md:table-cell"><div className="flex flex-wrap gap-1.5">{item.role_ids.length ? item.role_ids.map((id) => <Badge key={id} variant="outline">{roles.find((role) => role.id === id)?.name ?? id}</Badge>) : <span className="text-muted-foreground">No roles assigned</span>}</div></TableCell>
                  <TableCell className="text-right align-middle"><Button size="sm" variant="ghost" onClick={() => setSelectedUserId(item.user_id)}><span className="sm:hidden">{item.status === "pending" ? "Review" : "Manage"}</span><span className="hidden sm:inline">{item.status === "pending" ? "Review request" : "Manage access"}</span></Button></TableCell>
                </TableRow>
              ))}
              {requests.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No access requests yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
        <Sheet open={selectedUserId !== null} onOpenChange={(open) => { if (!open) setSelectedUserId(null); }}>
          <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-xl">
          {requests.filter((item) => item.user_id === selectedUserId).map((item) => (
            <div key={item.id} className="space-y-6">
              <SheetHeader className="pr-6">
                <SheetTitle>{item.display_name}</SheetTitle>
                <SheetDescription>{item.email}</SheetDescription>
                <div><Badge variant="outline">{item.status}</Badge></div>
              </SheetHeader>
              {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
              <fieldset disabled={busy !== "" || !["pending", "approved"].includes(item.status)} className="space-y-3 border-t pt-5">
                <legend className="text-sm font-semibold">Roles</legend>
                {roles.map((role) => (
                  <label key={role.id} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={(selectedRoles[item.user_id] ?? []).includes(role.id)}
                      onChange={(event) => setSelectedRoles((current) => ({
                        ...current,
                        [item.user_id]: event.target.checked
                          ? [...new Set([...(current[item.user_id] ?? []), role.id])]
                          : (current[item.user_id] ?? []).filter((id) => id !== role.id),
                      }))}
                    />
                    <span><span className="block font-medium">{role.name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{role.description}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-2 border-t pt-5">
                {item.status === "pending" ? (
                  <>
                    <Button size="sm" disabled={busy !== "" || (selectedRoles[item.user_id] ?? []).length === 0} onClick={() => void decide(item, "approved")}>Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => void decide(item, "rejected")}>Reject</Button>
                  </>
                ) : item.status === "approved" ? (
                  <>
                    <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => void updateUser(item.user_id, { action: "roles", role_ids: selectedRoles[item.user_id] ?? [] })}>Save roles</Button>
                    <Button size="sm" variant="destructive" disabled={busy !== ""} onClick={() => void updateUser(item.user_id, { action: "revoke" })}>Revoke</Button>
                  </>
                ) : null}
              </div>
              {item.status === "approved" ? (
                <div className="space-y-3 border-t pt-5">
                  <h3 className="text-sm font-semibold">Individual permissions</h3>
                  <p className="text-xs leading-5 text-muted-foreground">Grant or deny a permission independently of the assigned roles.</p>
                  <select aria-label="Individual permission" disabled={busy !== ""} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selectedPermission[item.user_id] ?? ""} onChange={(event) => setSelectedPermission((current) => ({ ...current, [item.user_id]: event.target.value }))}>
                    <option value="">Choose individual permission</option>
                    {permissions.map((permission) => <option key={permission} value={permission}>{permission}</option>)}
                  </select>
                  <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!selectedPermission[item.user_id] || busy !== ""} onClick={() => void updateUser(item.user_id, { action: "permission", permission: selectedPermission[item.user_id], granted: true })}>Grant</Button>
                  <Button size="sm" variant="outline" disabled={!selectedPermission[item.user_id] || busy !== ""} onClick={() => void updateUser(item.user_id, { action: "permission", permission: selectedPermission[item.user_id], granted: false })}>Revoke permission</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          </SheetContent>
        </Sheet>
      </section>

      <section role="tabpanel" id="admin-panel-mcp" aria-labelledby="admin-tab-mcp" hidden={activeTab !== "mcp"} className="py-7">
        <h2 className="text-lg font-semibold">Remote MCP access</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Each row is one authorised client connection. Its 15-minute access token renews automatically while the client is in use; after 30 days without renewal, the user must connect again. Client names are self-reported.</p>
        <div className="mt-4 border-y">
          <Table aria-label="Remote MCP connections">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Client</TableHead>
                <TableHead scope="col">User</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col" className="hidden lg:table-cell">Activity</TableHead>
                <TableHead scope="col" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcpGrants.map((grant) => {
                const status = grant.status === "active" ? "Active" : grant.status === "expired" ? "Expired" : "Revoked";
                return (
                  <TableRow key={grant.id}>
                    <TableCell className="min-w-48 py-5 align-top">
                      <span className="block font-medium">{grant.clientName}</span>
                      <span className="mt-1 block max-w-64 break-all font-mono text-[11px] text-muted-foreground">{grant.clientId}</span>
                    </TableCell>
                    <TableCell className="min-w-44 align-top">
                      <span className="block text-sm font-medium">{grant.userDisplayName || grant.userEmail}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{grant.userEmail}</span>
                    </TableCell>
                    <TableCell className="min-w-44 align-top">
                      <Badge variant={status === "Active" ? "default" : "secondary"}>{status}</Badge>
                      <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                        {status === "Active"
                          ? `Reconnect if unused after ${new Date(grant.refreshExpiresAt).toLocaleString()}`
                          : status === "Revoked" && grant.revokedAt
                            ? `Revoked ${new Date(grant.revokedAt).toLocaleString()}`
                            : `Expired ${new Date(grant.refreshExpiresAt).toLocaleString()}`}
                      </span>
                    </TableCell>
                    <TableCell className="hidden min-w-52 align-top text-xs leading-5 text-muted-foreground lg:table-cell">
                      <span className="block">Connected {new Date(grant.authorizedAt).toLocaleString()}</span>
                      <span className="block">Last renewed {new Date(grant.lastRenewedAt).toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {status === "Active" ? <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => void revokeMcpGrant(grant.id)}>Revoke access</Button> : <span className="text-xs text-muted-foreground">No access</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {mcpGrants.length === 0 ? <TableRow><TableCell colSpan={5} className="py-5 text-muted-foreground">No remote MCP connections yet.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section role="tabpanel" id="admin-panel-roles" aria-labelledby="admin-tab-roles" hidden={activeTab !== "roles"} className={activeTab === "roles" ? "space-y-8 py-7" : "hidden"}>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Roles <span className="ml-2 text-sm font-normal text-muted-foreground">{roles.length}</span></h2>
              <p className="mt-1 text-sm text-muted-foreground">Manage permission bundles for your organisation.</p>
            </div>
            <Button onClick={() => { setEditingRoleId(""); setRoleName(""); setRoleDescription(""); setRolePermissions([]); setRoleEditorOpen(true); }}>Create role</Button>
          </div>
          <div className="mt-4 border-y">
            <Table aria-label="Organisation roles">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Role</TableHead>
                  <TableHead scope="col" className="hidden lg:table-cell">Description</TableHead>
                  <TableHead scope="col" className="hidden sm:table-cell">Permissions</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="py-5 font-medium">{role.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{role.system ? "Built-in role" : "Custom role"}</span></TableCell>
                    <TableCell className="hidden min-w-48 max-w-sm whitespace-normal text-muted-foreground lg:table-cell">{role.description || "—"}</TableCell>
                    <TableCell className="hidden min-w-48 sm:table-cell">
                      <details>
                        <summary className="cursor-pointer text-sm focus-visible:outline-ring">{role.permissions.length} permissions</summary>
                        <ul className="mt-3 flex max-w-sm flex-wrap gap-1.5">{role.permissions.map((permission) => <li key={permission} className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">{permission}</li>)}</ul>
                      </details>
                    </TableCell>
                    <TableCell>
                      {!role.system ? <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy !== ""} onClick={() => { setEditingRoleId(role.id); setRoleName(role.name); setRoleDescription(role.description); setRolePermissions(role.permissions); setRoleEditorOpen(true); }}>Edit</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy !== ""} onClick={() => void deleteRole(role)}>Delete</Button></div> : <span className="block text-right text-xs text-muted-foreground">Read only</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {roles.length === 0 ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">No roles available.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </div>
        <Sheet open={roleEditorOpen} onOpenChange={setRoleEditorOpen}>
          <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-xl">
            <SheetHeader className="pr-6">
              <SheetTitle>{editingRoleId ? "Edit role" : "Create role"}</SheetTitle>
              <SheetDescription>Choose the permissions this role grants to its members.</SheetDescription>
            </SheetHeader>
        <form onSubmit={saveRole}>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          <label className="mt-4 block space-y-1.5 text-sm font-medium">Name<Input required value={roleName} onChange={(event) => setRoleName(event.target.value)} /></label>
          <label className="mt-4 block space-y-1.5 text-sm font-medium">Description<Textarea value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} rows={3} /></label>
          <fieldset className="mt-4"><legend className="text-sm font-medium">Permissions</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{permissions.map((permission) => (
            <label key={permission} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={rolePermissions.includes(permission)} onChange={(event) => setRolePermissions((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} />{permission}</label>
          ))}</div></fieldset>
          <div className="sticky bottom-0 mt-6 flex gap-2 border-t bg-background py-4"><Button disabled={busy !== ""} type="submit">{busy === "role" ? "Saving…" : editingRoleId ? "Save role" : "Create role"}</Button><Button type="button" variant="outline" disabled={busy !== ""} onClick={() => setRoleEditorOpen(false)}>Cancel</Button></div>
        </form>
          </SheetContent>
        </Sheet>
      </section>
    </div>
  );
}
