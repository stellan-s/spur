"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  GitMerge,
  FileCode2,
  LoaderCircle,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { entityDefinitionSchema } from "@/core/memory-types";
import type {
  MemoryAlias,
  MemoryObject,
  MemoryRelationship,
  StoredEvidence,
  Workspace,
} from "@/core/memory-types";
import { KIND_LABELS, MODEL_KINDS, ModelHeader, StateBadge } from "./model-views";

type MemoryDetail = {
  item: MemoryObject;
  evidence: StoredEvidence[];
  alias_evidence: Record<string, StoredEvidence[]>;
  relationships: MemoryRelationship[];
  related: MemoryObject[];
  management: {
    edit: boolean;
    promote: boolean;
    archive: boolean;
    merge: boolean;
    propose_alias: boolean;
    review_alias: boolean;
  };
};

function apiError(payload: unknown, fallback: string): string {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ModelEntityDetail({
  workspace,
  entityId,
  onRefresh,
}: {
  workspace: Workspace;
  entityId: string;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const basePath = `/o/${workspace.organization.slug}`;
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"promote" | "edit" | "archive" | "merge" | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeConfirmation, setMergeConfirmation] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [kind, setKind] = useState<MemoryObject["kind"]>("observation");
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [subjects, setSubjects] = useState("");
  const [owner, setOwner] = useState("");
  const [steward, setSteward] = useState("");
  const [entityDefinitionText, setEntityDefinitionText] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [aliasBusy, setAliasBusy] = useState<string | null>(null);
  const [aliasReviewNotes, setAliasReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memory/${encodeURIComponent(entityId)}`, {
      cache: "no-store",
      headers: { "x-spur-organization": workspace.organization.slug },
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(payload, "Memory object could not be loaded."));
        if (!cancelled) {
          setDetail(payload as MemoryDetail);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Memory object could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, workspace.organization.slug]);

  function startEditing() {
    if (!detail) return;
    setKind(detail.item.kind);
    setTitle(detail.item.title);
    setStatement(detail.item.statement);
    setSubjects(detail.item.subjects.join(", "));
    setOwner(typeof detail.item.metadata.owner === "string" ? detail.item.metadata.owner : "");
    setSteward(typeof detail.item.metadata.steward === "string" ? detail.item.metadata.steward : "");
    setEntityDefinitionText(
      JSON.stringify(
        entityDefinitionSchema.safeParse(detail.item.metadata.entity_definition).success
          ? detail.item.metadata.entity_definition
          : { attributes: [], data_locations: [] },
        null,
        2,
      ),
    );
    setEditing(true);
    setConfirmDelete(false);
    setError(null);
  }

  async function mutate(
    action: "promote" | "edit" | "archive",
    body: Record<string, unknown>,
  ): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(entityId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify(body),
      });
      if (response.status === 204) {
        router.push(`${basePath}/model/catalog${detail?.item.kind === "decision" ? "?kind=decision" : ""}`);
        router.refresh();
        return;
      }
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Memory object could not be updated."));
      setDetail(payload as MemoryDetail);
      setEditing(false);
      setConfirmDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Memory object could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let entityDefinition: unknown;
    if (kind === "entity") {
      try {
        entityDefinition = entityDefinitionSchema.parse(JSON.parse(entityDefinitionText));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The entity definition is not valid JSON.");
        return;
      }
    }
    await mutate("edit", {
      action: "edit",
      kind,
      title,
      statement,
      subjects: subjects.split(",").map((subject) => subject.trim()).filter(Boolean),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
      ...(steward.trim() ? { steward: steward.trim() } : {}),
      ...(kind === "entity" ? { entity_definition: entityDefinition } : {}),
    });
  }

  async function submitMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !mergeTargetId || mergeConfirmation !== entityId) return;
    setBusy("merge");
    setError(null);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(entityId)}/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify({ source_id: entityId, target_id: mergeTargetId, confirmation: mergeConfirmation }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        throw new Error(apiError(payload, "Catalog objects could not be merged."));
      }
      await onRefresh();
      router.push(`${basePath}/model/catalog/${encodeURIComponent(mergeTargetId)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Catalog objects could not be merged.");
    } finally {
      setBusy(null);
    }
  }

  function updateAlias(alias: MemoryAlias) {
    setDetail((current) => current ? {
      ...current,
      item: {
        ...current.item,
        aliases: [
          ...(current.item.aliases ?? []).filter((candidate) => candidate.id !== alias.id),
          alias,
        ].sort((left, right) => left.created_at.localeCompare(right.created_at)),
      },
    } : current);
  }

  async function submitAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = aliasName.trim();
    if (!name) return;
    setAliasBusy("propose");
    setError(null);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(entityId)}/aliases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify({ name }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Alias proposal could not be saved."));
      updateAlias(payload as MemoryAlias);
      setAliasName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alias proposal could not be saved.");
    } finally {
      setAliasBusy(null);
    }
  }

  async function reviewAlias(alias: MemoryAlias, action: "verify" | "reject") {
    const note = aliasReviewNotes[alias.id]?.trim() ?? "";
    if (note.length < 3) return;
    setAliasBusy(alias.id);
    setError(null);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(entityId)}/aliases`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify({
          alias_id: alias.id,
          action,
          note,
          confirmation: alias.id,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Alias review could not be saved."));
      updateAlias(payload as MemoryAlias);
      setAliasReviewNotes((notes) => ({ ...notes, [alias.id]: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alias review could not be saved.");
    } finally {
      setAliasBusy(null);
    }
  }

  const item = detail?.item;
  const mergeCandidates = workspace.memory.filter((candidate) =>
    candidate.id !== entityId && candidate.kind === item?.kind && candidate.metadata.configured_source !== true);
  const mergeTargets = mergeCandidates.filter((candidate) =>
    `${candidate.title} ${candidate.statement}`.toLocaleLowerCase().includes(mergeQuery.trim().toLocaleLowerCase())).slice(0, 12);
  const mergeTarget = mergeCandidates.find((candidate) => candidate.id === mergeTargetId);
  const relatedById = new Map(detail?.related.map((related) => [related.id, related]) ?? []);
  const management = detail?.management;
  const parsedEntityDefinition = item?.kind === "entity"
    ? entityDefinitionSchema.safeParse(item.metadata.entity_definition)
    : null;
  const entityDefinition = parsedEntityDefinition?.success ? parsedEntityDefinition.data : null;

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <ModelHeader workspace={workspace} active="catalog" />

      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 border-b py-4 text-sm text-muted-foreground">
        <Link href={`${basePath}/model`} className="hover:text-foreground">Model</Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`${basePath}/model/catalog${item?.kind === "decision" ? "?kind=decision" : ""}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Catalog
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">{item?.title ?? "Object"}</span>
      </nav>

      {loading ? (
        <div className="flex min-h-[420px] items-center justify-center">
          <LoaderCircle className="size-6 animate-spin text-primary" aria-label="Loading catalog item" />
        </div>
      ) : error && !detail ? (
        <Alert variant="destructive" className="mt-8 max-w-2xl">
          <AlertTitle>Catalog item unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : item && detail ? (
        <>
          <header className="border-b py-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-5xl">
                <Badge variant="outline" className="rounded-full border-primary/20 bg-brand-tint px-3 py-1 text-xs font-semibold text-foreground">
                  {KIND_LABELS[item.kind]}
                </Badge>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{item.title}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StateBadge item={item} />
                  {item.authority === "person" ? (
                    <Badge variant="success" className="gap-1.5 font-normal">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Human verified
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-4 max-w-4xl text-base leading-7 text-muted-foreground">{item.statement}</p>
                <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Owner</dt>
                    <dd className="mt-0.5 font-medium">{typeof item.metadata.owner === "string" ? item.metadata.owner : "Not assigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Steward</dt>
                    <dd className="mt-0.5 font-medium">{typeof item.metadata.steward === "string" ? item.metadata.steward : "Not assigned"}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {item.state === "candidate" ? (
                  <Button
                    type="button"
                    disabled={!management?.promote || busy !== null}
                    onClick={() => void mutate("promote", { action: "promote" })}
                  >
                    {busy === "promote" ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Promote
                  </Button>
                ) : null}
                <Button type="button" variant="outline" disabled={!management?.edit || busy !== null} onClick={startEditing}>
                  <Pencil className="size-4" /> Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!management?.merge || busy !== null || item.metadata.configured_source === true || mergeCandidates.length === 0}
                  onClick={() => {
                    setMerging(true);
                    setEditing(false);
                    setConfirmDelete(false);
                    setError(null);
                  }}
                >
                  <GitMerge className="size-4" /> Merge
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!management?.archive || busy !== null}
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setConfirmDelete(true);
                    setEditing(false);
                    setError(null);
                  }}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            </div>
          </header>

          <section className="border-b py-7" aria-labelledby="management-heading">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h2 id="management-heading" className="text-sm font-medium">Management access</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Actions are enabled when your account has the required permission.
                </p>
              </div>
              {Object.values(detail.management).some(Boolean) ? (
                <Badge variant="secondary">Permission granted</Badge>
              ) : (
                <Badge variant="warning" className="font-normal">
                  Read only
                </Badge>
              )}
            </div>
          </section>

          {error ? (
            <Alert variant="destructive" className="my-6 max-w-3xl">
              <AlertTitle>Change not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {merging ? (
            <section className="border-b py-8" aria-labelledby="merge-heading">
              <h2 id="merge-heading" className="text-base font-semibold">Merge catalog objects</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                This object will be archived. The object you keep retains its title, statement, and status; subjects, evidence, and relationships are carried over. Entity attributes and locations merge only when they do not conflict.
              </p>
              <form onSubmit={submitMerge} className="mt-5 max-w-3xl space-y-5">
                <div>
                  <label htmlFor="merge-search" className="mb-1.5 block text-sm font-medium">Choose the object to keep</label>
                  <Input id="merge-search" value={mergeQuery} onChange={(event) => setMergeQuery(event.target.value)} placeholder="Search objects of the same type" />
                  <div className="mt-2 max-h-56 overflow-y-auto border-y" role="group" aria-label="Objects to keep">
                    {mergeTargets.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setMergeTargetId(candidate.id)}
                        aria-pressed={mergeTargetId === candidate.id}
                        className={`block w-full border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60 ${mergeTargetId === candidate.id ? "bg-brand-tint" : ""}`}
                      >
                        <span className="block text-sm font-medium">{candidate.title}</span>
                        <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">{candidate.statement}</span>
                      </button>
                    ))}
                    {mergeTargets.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">No matching objects.</p> : null}
                  </div>
                </div>
                {mergeTarget ? <p className="text-sm">Keep <span className="font-medium">{mergeTarget.title}</span> · Archive <span className="font-medium">{item.title}</span></p> : null}
                <div>
                  <label htmlFor="merge-confirmation" className="mb-1.5 block text-sm font-medium">Type this object’s ID to confirm</label>
                  <code className="mb-2 block text-xs text-muted-foreground">{item.id}</code>
                  <Input id="merge-confirmation" value={mergeConfirmation} onChange={(event) => setMergeConfirmation(event.target.value)} className="font-mono" />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={!mergeTarget || mergeConfirmation !== item.id || busy !== null}>
                    {busy === "merge" ? <LoaderCircle className="size-4 animate-spin" /> : <GitMerge className="size-4" />}Merge into selected object
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setMerging(false)}>Cancel</Button>
                </div>
              </form>
            </section>
          ) : null}

          {editing ? (
            <section className="border-b py-8" aria-labelledby="edit-entity-heading">
              <h2 id="edit-entity-heading" className="text-base font-semibold">Edit catalog item</h2>
              <form onSubmit={saveEdit} className="mt-5 max-w-4xl space-y-5">
                <div>
                  <label htmlFor="entity-kind" className="mb-1.5 block text-xs font-medium text-muted-foreground">Type</label>
                  <select
                    id="entity-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as MemoryObject["kind"])}
                    className="h-9 min-w-56 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {(["application", ...MODEL_KINDS, "decision"] as MemoryObject["kind"][]).map((candidate) => <option key={candidate} value={candidate}>{KIND_LABELS[candidate]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="entity-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">Title</label>
                  <Input id="entity-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={160} />
                </div>
                <div>
                  <label htmlFor="entity-statement" className="mb-1.5 block text-xs font-medium text-muted-foreground">Statement</label>
                  <Textarea id="entity-statement" value={statement} onChange={(event) => setStatement(event.target.value)} required minLength={5} maxLength={4000} className="min-h-36" />
                </div>
                <div>
                  <label htmlFor="entity-subjects" className="mb-1.5 block text-xs font-medium text-muted-foreground">Subjects</label>
                  <Input id="entity-subjects" value={subjects} onChange={(event) => setSubjects(event.target.value)} placeholder="Comma-separated subjects" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="entity-owner" className="mb-1.5 block text-xs font-medium text-muted-foreground">Owner</label>
                    <Input id="entity-owner" value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={120} placeholder="Role that decides on this" />
                  </div>
                  <div>
                    <label htmlFor="entity-steward" className="mb-1.5 block text-xs font-medium text-muted-foreground">Steward</label>
                    <Input id="entity-steward" value={steward} onChange={(event) => setSteward(event.target.value)} maxLength={120} placeholder="Role that maintains this" />
                  </div>
                </div>
                {kind === "entity" ? (
                  <div>
                    <label htmlFor="entity-definition" className="mb-1.5 block text-xs font-medium text-muted-foreground">Entity definition</label>
                    <Textarea
                      id="entity-definition"
                      value={entityDefinitionText}
                      onChange={(event) => setEntityDefinitionText(event.target.value)}
                      className="min-h-72 font-mono text-xs"
                      spellCheck={false}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      JSON with technical_name, information_classification, attributes and data_locations.
                    </p>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={busy !== null}>
                    {busy === "edit" ? <LoaderCircle className="size-4 animate-spin" /> : null} Save changes
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </form>
            </section>
          ) : null}

          {entityDefinition ? (
            <section className="border-b py-8" aria-labelledby="data-definition-heading">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="data-definition-heading" className="text-base font-semibold">Data definition</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Structure, information classification, and known storage locations.</p>
                </div>
                {entityDefinition.information_classification ? (
                  <Badge variant="outline" className="font-normal">{entityDefinition.information_classification}</Badge>
                ) : null}
              </div>

              <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-4 text-sm">
                <div className="min-w-56">
                  <dt className="text-xs text-muted-foreground">Technical name</dt>
                  <dd className="mt-1 font-mono text-xs font-medium">{entityDefinition.technical_name ?? "Not recorded"}</dd>
                </div>
                <div className="min-w-48">
                  <dt className="text-xs text-muted-foreground">Attributes</dt>
                  <dd className="mt-1 font-medium tabular-nums">{entityDefinition.attributes.length}</dd>
                </div>
                <div className="min-w-48">
                  <dt className="text-xs text-muted-foreground">Data locations</dt>
                  <dd className="mt-1 font-medium tabular-nums">{entityDefinition.data_locations.length}</dd>
                </div>
              </dl>

              {entityDefinition.attributes.length > 0 ? (
                <div className="mt-7 overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/45">
                      <TableRow className="hover:bg-muted/45">
                        <TableHead>Attribute</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Constraints</TableHead>
                        <TableHead className="min-w-72">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entityDefinition.attributes.map((attribute) => (
                        <TableRow key={attribute.name}>
                          <TableCell className="font-mono text-xs font-medium">{attribute.name}</TableCell>
                          <TableCell className="font-mono text-xs">{attribute.data_type}</TableCell>
                          <TableCell>{attribute.information_classification ?? entityDefinition.information_classification ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {attribute.identifier ? <Badge variant="secondary">identifier</Badge> : null}
                              {attribute.required ? <Badge variant="secondary">required</Badge> : null}
                              {attribute.unique ? <Badge variant="secondary">unique</Badge> : null}
                              {!attribute.identifier && !attribute.required && !attribute.unique ? "—" : null}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-normal text-xs text-muted-foreground">{attribute.description ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <p className="mt-6 text-sm text-muted-foreground">No attributes modeled yet.</p>}

              {entityDefinition.data_locations.length > 0 ? (
                <div className="mt-7">
                  <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Where this information is stored</h3>
                  <div className="mt-3 overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader className="bg-muted/45">
                        <TableRow className="hover:bg-muted/45">
                          <TableHead>System</TableHead>
                          <TableHead>Storage</TableHead>
                          <TableHead>Locator</TableHead>
                          <TableHead>Environment</TableHead>
                          <TableHead>Role</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entityDefinition.data_locations.map((location, index) => (
                          <TableRow key={`${location.system}:${location.locator}:${index}`}>
                            <TableCell className="font-medium">{location.system}</TableCell>
                            <TableCell>{location.storage_type}</TableCell>
                            <TableCell className="font-mono text-xs">{location.locator}</TableCell>
                            <TableCell>{location.environment ?? "—"}</TableCell>
                            <TableCell>{location.role?.replaceAll("_", " ") ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : <p className="mt-6 text-sm text-muted-foreground">No data locations modeled yet.</p>}
            </section>
          ) : null}

          <section className="border-b py-8" aria-labelledby="aliases-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="aliases-heading" className="text-base font-semibold">Aliases</h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                  Alternate names improve retrieval without changing the canonical title. Every alias keeps its origin and review status.
                </p>
              </div>
              <Badge variant="secondary" className="font-normal">{item.aliases?.length ?? 0} recorded</Badge>
            </div>

            {(item.aliases?.length ?? 0) > 0 ? (
              <div className="mt-5 divide-y border-y">
                {item.aliases?.map((alias) => (
                  <article key={alias.id} className="py-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{alias.name}</p>
                      <Badge variant={alias.origin === "user" ? "warning" : "outline"}>
                        {alias.origin === "user" ? "User-generated" : alias.origin === "repository" ? "Repository-derived" : alias.origin}
                      </Badge>
                      <Badge variant={alias.status === "verified" ? "success" : alias.status === "rejected" ? "destructive" : "secondary"}>
                        {alias.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {alias.scope} scope · submitted by {alias.actor ?? "Unknown"} · {dateTime(alias.created_at)}
                    </p>
                    {(detail.alias_evidence[alias.id]?.length ?? 0) > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Evidence: {detail.alias_evidence[alias.id].map((evidence) => `${evidence.path}:${evidence.start_line}-${evidence.end_line}`).join(", ")}
                      </p>
                    ) : alias.origin === "user" ? (
                      <p className="mt-1 text-xs text-muted-foreground">No source evidence attached; this remains attributable to the user.</p>
                    ) : null}
                    {alias.reviewed_at ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reviewed by {alias.reviewed_by ?? "Unknown"} · {dateTime(alias.reviewed_at)}{alias.review_note ? ` · ${alias.review_note}` : ""}
                      </p>
                    ) : null}
                    {alias.status === "proposed" && management?.review_alias ? (
                      <div className="mt-4 max-w-2xl">
                        <label htmlFor={`alias-review-${alias.id}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">Review note</label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id={`alias-review-${alias.id}`}
                            value={aliasReviewNotes[alias.id] ?? ""}
                            onChange={(event) => setAliasReviewNotes((notes) => ({ ...notes, [alias.id]: event.target.value }))}
                            minLength={3}
                            maxLength={500}
                            placeholder="Evidence or reason for this decision"
                          />
                          <Button type="button" size="sm" disabled={aliasBusy !== null || (aliasReviewNotes[alias.id]?.trim().length ?? 0) < 3} onClick={() => void reviewAlias(alias, "verify")}>Verify</Button>
                          <Button type="button" size="sm" variant="outline" disabled={aliasBusy !== null || (aliasReviewNotes[alias.id]?.trim().length ?? 0) < 3} onClick={() => void reviewAlias(alias, "reject")}>Reject</Button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : <p className="mt-5 text-sm text-muted-foreground">No aliases recorded.</p>}

            {management?.propose_alias ? (
              <form onSubmit={submitAlias} className="mt-6 max-w-2xl">
                <label htmlFor="alias-name" className="mb-1.5 block text-sm font-medium">Suggest an alias</label>
                <p className="mb-3 text-xs leading-5 text-muted-foreground">
                  This is stored as a user-generated proposal. It cannot verify this catalog item or close a knowledge gap.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="alias-name" value={aliasName} onChange={(event) => setAliasName(event.target.value)} minLength={2} maxLength={160} placeholder="Alternate name" />
                  <Button type="submit" disabled={aliasBusy !== null || aliasName.trim().length < 2}>
                    {aliasBusy === "propose" ? <LoaderCircle className="size-4 animate-spin" /> : null}Save proposal
                  </Button>
                </div>
              </form>
            ) : null}
          </section>

          <section className="border-b py-8" aria-labelledby="provenance-heading">
            <h2 id="provenance-heading" className="text-base font-semibold">Provenance</h2>
            <dl className="mt-5 flex flex-wrap gap-x-12 gap-y-5 text-sm">
              {[
                ["Confidence", `${Math.round(item.confidence * 100)}%`],
                ["Authority", item.authority.replaceAll("_", " ")],
                ["Modeled by", String(item.metadata.client_name ?? item.actor ?? "Unknown")],
                ["Source version", item.source_version?.slice(0, 12) ?? "Not pinned"],
                ["Updated", dateTime(item.updated_at)],
                ["Entity ID", item.id],
              ].map(([label, value]) => (
                <div key={label} className="min-w-40">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 max-w-72 truncate font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {item.subjects.length > 0 ? (
              <div className="mt-6 flex flex-wrap gap-1.5">
                {item.subjects.map((subject) => <Badge key={subject} variant="secondary" className="font-normal">{subject}</Badge>)}
              </div>
            ) : null}
            {Array.isArray(item.metadata.merged_from_ids) && item.metadata.merged_from_ids.length > 0 ? (
              <p className="mt-5 text-xs text-muted-foreground">
                Merged from {item.metadata.merged_from_ids.length} archived catalog {item.metadata.merged_from_ids.length === 1 ? "object" : "objects"}; originals remain in the audit store.
              </p>
            ) : null}
          </section>

          <section className="border-b py-8" aria-labelledby="evidence-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 id="evidence-heading" className="text-base font-semibold">Evidence</h2>
                <p className="mt-1 text-xs text-muted-foreground">Exact excerpts retained from the connected source version.</p>
              </div>
              <Badge variant="secondary" className="font-normal">{detail.evidence.length} excerpts</Badge>
            </div>
            {detail.evidence.length > 0 ? (
              <div className="mt-5 divide-y border-y">
                {detail.evidence.map((evidence) => (
                  <article key={evidence.id} className="py-5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <FileCode2 className="size-4" aria-hidden="true" />
                      <code>{evidence.path}:{evidence.start_line}-{evidence.end_line}</code>
                      <Badge variant="outline" className="font-normal">{evidence.kind}</Badge>
                    </div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/55 p-4 text-xs leading-5">{evidence.excerpt}</pre>
                  </article>
                ))}
              </div>
            ) : <p className="mt-5 text-sm text-muted-foreground">No retained excerpts for this entity.</p>}
          </section>

          <section className="border-b py-8" aria-labelledby="relations-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 id="relations-heading" className="text-base font-semibold">Relationships</h2>
                <p className="mt-1 text-xs text-muted-foreground">Direct incoming and outgoing connections.</p>
              </div>
              <Badge variant="secondary" className="font-normal">{detail.relationships.length} direct</Badge>
            </div>
            {detail.relationships.length > 0 ? (
              <ul className="mt-5 divide-y border-y">
                {detail.relationships.map((relationship) => {
                  const outgoing = relationship.from_id === item.id;
                  const otherId = outgoing ? relationship.to_id : relationship.from_id;
                  const other = relatedById.get(otherId);
                  return (
                    <li key={relationship.id}>
                      <Link href={`${basePath}/model/catalog/${encodeURIComponent(otherId)}`} className="group flex items-center justify-between gap-5 py-4">
                        <span className="min-w-0">
                          <span className="text-xs text-muted-foreground">{relationship.predicate.replaceAll("_", " ")} · {outgoing ? "outgoing" : "incoming"}</span>
                          <span className="mt-1 block truncate text-sm font-medium group-hover:text-primary">{other?.title ?? otherId}</span>
                          {typeof relationship.metadata.cardinality === "string" ? (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {relationship.metadata.cardinality.replaceAll("_", " ")}
                              {typeof relationship.metadata.source_attribute === "string" || typeof relationship.metadata.target_attribute === "string"
                                ? ` · ${String(relationship.metadata.source_attribute ?? "?")} → ${String(relationship.metadata.target_attribute ?? "?")}`
                                : ""}
                            </span>
                          ) : null}
                        </span>
                        <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-5 text-sm text-muted-foreground">No direct relationships.</p>}
          </section>

          <section className="py-8" aria-labelledby="danger-heading">
            <h2 id="danger-heading" className="text-base font-semibold text-destructive">Danger zone</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Delete hides the entity from catalog, search, maps and MCP recall. Its record remains in SQLite for recovery and audit.
            </p>
            {!confirmDelete ? (
              <Button
                type="button"
                variant="outline"
                disabled={!management?.archive || busy !== null}
                className="mt-5 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" /> Delete entity
              </Button>
            ) : (
              <div className="mt-5 max-w-2xl border-y border-destructive/25 py-5">
                <p className="text-sm font-medium">Type the catalog item ID to confirm</p>
                <code className="mt-1 block text-xs text-muted-foreground">{item.id}</code>
                <Input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder={item.id}
                  aria-label="Confirm entity ID"
                  className="mt-4 font-mono"
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleteConfirmation !== item.id || busy !== null}
                    onClick={() => void mutate("archive", { action: "archive", confirmation: deleteConfirmation })}
                  >
                    {busy === "archive" ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    Confirm delete
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => {
                    setConfirmDelete(false);
                    setDeleteConfirmation("");
                  }}>Cancel</Button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
