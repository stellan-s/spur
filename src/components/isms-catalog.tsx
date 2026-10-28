"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Pencil, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { IsmsControl, IsmsControlInput, IsmsControlRevision } from "@/core/isms-types";
import type { MemoryObject, Workspace } from "@/core/memory-types";

type ControlDetail = {
  control: IsmsControl;
  linked_memory: MemoryObject[];
  revisions: IsmsControlRevision[];
};

const EMPTY_CONTROL: IsmsControlInput = {
  reference: "",
  framework: "",
  framework_version: "",
  title: "",
  objective: "",
  owner: "",
  applicability: "undecided",
  applicability_rationale: "",
  implementation_status: "not_assessed",
  review_due_on: null,
  evidence_references: [],
  linked_memory_ids: [],
};

const APPLICABILITY: Record<IsmsControl["applicability"], string> = {
  undecided: "Undecided",
  applicable: "Applicable",
  not_applicable: "Not applicable",
};
const IMPLEMENTATION: Record<IsmsControl["implementation_status"], string> = {
  not_assessed: "Not assessed",
  planned: "Planned",
  implemented: "Reported implemented",
};

function errorMessage(payload: unknown, fallback: string): string {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

function ControlForm({
  value,
  onChange,
  candidates,
  onSubmit,
  busy,
}: {
  value: IsmsControlInput;
  onChange: (next: IsmsControlInput) => void;
  candidates: MemoryObject[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
}) {
  const [linkQuery, setLinkQuery] = useState("");
  const linked = new Set(value.linked_memory_ids);
  const visibleCandidates = candidates.filter((item) =>
    linked.has(item.id) || `${item.title} ${item.kind} ${item.statement}`.toLowerCase().includes(linkQuery.toLowerCase()),
  ).slice(0, 12);
  const update = <K extends keyof IsmsControlInput>(key: K, next: IsmsControlInput[K]) => onChange({ ...value, [key]: next });
  return (
    <form onSubmit={onSubmit} className="space-y-5 pb-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">Reference<Input required value={value.reference} onChange={(event) => update("reference", event.target.value)} placeholder="A.5.1" /></label>
        <label className="space-y-1.5 text-sm font-medium">Owner<Input required value={value.owner} onChange={(event) => update("owner", event.target.value)} placeholder="Security owner" /></label>
        <label className="space-y-1.5 text-sm font-medium">Framework<Input required value={value.framework} onChange={(event) => update("framework", event.target.value)} placeholder="Organization control set" /></label>
        <label className="space-y-1.5 text-sm font-medium">Framework version<Input value={value.framework_version} onChange={(event) => update("framework_version", event.target.value)} placeholder="Optional" /></label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">Title<Input required value={value.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label className="block space-y-1.5 text-sm font-medium">Control objective<Textarea required value={value.objective} onChange={(event) => update("objective", event.target.value)} rows={4} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">Applicability
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={value.applicability} onChange={(event) => update("applicability", event.target.value as IsmsControlInput["applicability"])}>
            {Object.entries(APPLICABILITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">Implementation
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={value.implementation_status} onChange={(event) => update("implementation_status", event.target.value as IsmsControlInput["implementation_status"])}>
            {Object.entries(IMPLEMENTATION).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">Applicability rationale
        <Textarea value={value.applicability_rationale} onChange={(event) => update("applicability_rationale", event.target.value)} rows={2} placeholder="Required when not applicable" />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">Review due<Input type="date" value={value.review_due_on ?? ""} onChange={(event) => update("review_due_on", event.target.value || null)} /></label>
      <div className="border-t pt-5">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Assessment evidence</p><Button type="button" size="sm" variant="outline" onClick={() => update("evidence_references", [...value.evidence_references, { label: "", locator: "" }])}><Plus />Add reference</Button></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Record where a reviewer can find the evidence. References are not verified automatically.</p>
        <div className="mt-3 space-y-3">{value.evidence_references.map((reference, index) => (
          <div key={index} className="grid gap-2 border-b pb-3 sm:grid-cols-[1fr_1.5fr_auto]">
            <Input aria-label={`Evidence ${index + 1} label`} required value={reference.label} onChange={(event) => update("evidence_references", value.evidence_references.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="Document or test name" />
            <Input aria-label={`Evidence ${index + 1} location`} required value={reference.locator} onChange={(event) => update("evidence_references", value.evidence_references.map((item, itemIndex) => itemIndex === index ? { ...item, locator: event.target.value } : item))} placeholder="URL or internal document reference" />
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove evidence ${index + 1}`} onClick={() => update("evidence_references", value.evidence_references.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button>
          </div>
        ))}</div>
      </div>
      <div className="border-t pt-5">
        <p className="text-sm font-medium">Mapped model objects</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Links describe potential implementation or scope. They are not evidence that a control is effective.</p>
        <Input aria-label="Search model objects" className="mt-3" value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="Search technical controls, systems, information…" />
        <div className="mt-2 max-h-48 overflow-y-auto border-y">
          {visibleCandidates.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-3 border-b py-2.5 text-sm last:border-b-0">
              <input type="checkbox" className="mt-1" checked={linked.has(item.id)} onChange={(event) => update("linked_memory_ids", event.target.checked ? [...value.linked_memory_ids, item.id] : value.linked_memory_ids.filter((id) => id !== item.id))} />
              <span><span className="font-medium">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.kind}</span></span>
            </label>
          ))}
          {visibleCandidates.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No matching model objects.</p> : null}
        </div>
      </div>
      <Button disabled={busy} type="submit">{busy ? <LoaderCircle className="animate-spin" /> : <Check />}Save as draft</Button>
    </form>
  );
}

export function IsmsCatalog({ workspace, initialSelected = "" }: { workspace: Workspace; initialSelected?: string }) {
  const router = useRouter();
  const basePath = `/o/${workspace.organization.slug}/isms/controls`;
  const [controls, setControls] = useState<IsmsControl[]>([]);
  const [detail, setDetail] = useState<ControlDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<IsmsControlInput>(EMPTY_CONTROL);
  const [confirmation, setConfirmation] = useState("");
  const selected = initialSelected;
  const activeDetail = detail?.control.id === selected ? detail : null;
  const canPropose = workspace.permissions?.includes("isms.propose") === true;
  const canApprove = workspace.permissions?.includes("isms.approve") === true;
  const canArchive = workspace.permissions?.includes("isms.archive") === true;

  async function refresh() {
    const response = await fetch("/api/isms/controls", { cache: "no-store", headers: { "x-spur-organization": workspace.organization.slug } });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "Controls could not be loaded."));
    setControls((payload as { controls: IsmsControl[] }).controls);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/isms/controls", { cache: "no-store", headers: { "x-spur-organization": workspace.organization.slug } })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload, "Controls could not be loaded."));
        if (!cancelled) setControls((payload as { controls: IsmsControl[] }).controls);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Controls could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspace.organization.slug]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/isms/controls/${encodeURIComponent(selected)}`, { cache: "no-store", headers: { "x-spur-organization": workspace.organization.slug } })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload, "Control could not be loaded."));
        if (!cancelled) setDetail(payload as ControlDetail);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Control could not be loaded."); });
    return () => { cancelled = true; };
  }, [selected, workspace.organization.slug]);

  const visible = useMemo(() => controls.filter((item) => {
    if (filter !== "all" && item.governance_state !== filter) return false;
    return `${item.reference} ${item.title} ${item.framework} ${item.owner} ${item.objective}`.toLowerCase().includes(query.toLowerCase());
  }), [controls, filter, query]);
  const candidateMemory = useMemo(() => workspace.memory.filter((item) => !item.metadata.deleted_at), [workspace.memory]);

  function closeSheet() {
    setCreating(false);
    setEditing(false);
    setConfirmation("");
    setError("");
    router.replace(basePath, { scroll: false });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (editing && !activeDetail) throw new Error("Control details are still loading. Try again.");
      const id = editing ? activeDetail?.control.id : undefined;
      const response = await fetch(id ? `/api/isms/controls/${encodeURIComponent(id)}` : "/api/isms/controls", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-spur-organization": workspace.organization.slug },
        body: JSON.stringify(id ? { action: "save", expected_version: activeDetail!.control.version, control: form } : form),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Control could not be saved."));
      const control = (payload as { control?: IsmsControl }).control ?? (payload as ControlDetail).control;
      await refresh();
      setCreating(false);
      setEditing(false);
      if (id) setDetail(payload as ControlDetail);
      else router.replace(`${basePath}?selected=${encodeURIComponent(control.id)}`, { scroll: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Control could not be saved.");
    } finally { setBusy(false); }
  }

  async function changeState(action: "approve" | "archive") {
    if (!activeDetail) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/isms/controls/${encodeURIComponent(activeDetail.control.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-spur-organization": workspace.organization.slug },
        body: JSON.stringify({ action, expected_version: activeDetail.control.version, ...(action === "archive" ? { confirmation } : {}) }),
      });
      if (response.status === 204) {
        await refresh();
        closeSheet();
        return;
      }
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Control could not be updated."));
      setDetail(payload as ControlDetail);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Control could not be updated.");
    } finally { setBusy(false); }
  }

  const activeControl = activeDetail?.control ?? controls.find((item) => item.id === selected);
  return (
    <div className="w-full px-5 py-7 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-7">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">{workspace.organization.name} / ISMS</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Control catalog</h1>
          <p className="mt-2 text-sm text-muted-foreground">Governed controls, separate from safeguards observed in source code.</p>
        </div>
        <Button disabled={!canPropose} onClick={() => { setForm({ ...EMPTY_CONTROL, owner: workspace.actor }); setCreating(true); setEditing(false); setError(""); }}><Plus />Add control</Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b py-5 text-sm">
        <span><strong className="mr-1 font-semibold tabular-nums">{controls.length}</strong><span className="text-muted-foreground">controls</span></span>
        <span><strong className="mr-1 font-semibold tabular-nums">{controls.filter((item) => item.governance_state === "approved").length}</strong><span className="text-muted-foreground">approved</span></span>
        <span><strong className="mr-1 font-semibold tabular-nums">{controls.filter((item) => item.linked_memory_ids.length > 0).length}</strong><span className="text-muted-foreground">mapped to the model</span></span>
      </div>

      <div className="flex flex-wrap items-center gap-3 py-5">
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-[220px] sm:basis-auto sm:max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search controls" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search controls" /></div>
        <select aria-label="Filter approval status" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm sm:flex-none" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All states</option><option value="draft">Draft</option><option value="approved">Approved</option>
        </select>
        <Link href={`/o/${workspace.organization.slug}/model/catalog?kind=control`} className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Technical controls ↗</Link>
      </div>

      {error && !creating && !selected ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {loading ? <p className="py-12 text-sm text-muted-foreground">Loading controls…</p> : visible.length === 0 ? (
        <div className="border-t py-16 text-center"><ShieldCheck className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{controls.length ? "No controls match the filters" : "No ISMS controls yet"}</p><p className="mt-1 text-sm text-muted-foreground">Add an owned control to start the catalog.</p></div>
      ) : (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader><TableRow><TableHead className="hidden sm:table-cell">Reference</TableHead><TableHead>Control</TableHead><TableHead className="hidden lg:table-cell">Owner</TableHead><TableHead className="hidden md:table-cell">Applicability</TableHead><TableHead className="hidden xl:table-cell">Implementation</TableHead><TableHead>State</TableHead><TableHead className="hidden text-right sm:table-cell">Updated</TableHead></TableRow></TableHeader>
            <TableBody>{visible.map((item) => (
              <TableRow key={item.id} className="cursor-pointer" onClick={() => router.replace(`${basePath}?selected=${encodeURIComponent(item.id)}`, { scroll: false })}>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{item.reference}</TableCell>
                <TableCell className="whitespace-normal"><span className="mb-1 block font-mono text-[11px] text-muted-foreground sm:hidden">{item.reference}</span><span className="font-medium">{item.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.framework}{item.framework_version ? ` · ${item.framework_version}` : ""}</span></TableCell>
                <TableCell className="hidden lg:table-cell">{item.owner}</TableCell><TableCell className="hidden md:table-cell">{APPLICABILITY[item.applicability]}</TableCell><TableCell className="hidden xl:table-cell">{IMPLEMENTATION[item.implementation_status]}</TableCell>
                <TableCell><Badge variant={item.governance_state === "approved" ? "secondary" : "outline"}>{item.governance_state}</Badge></TableCell>
                <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">{dateLabel(item.updated_at)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}

      <Sheet open={creating || Boolean(selected)} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent className="w-full max-w-none overflow-y-auto p-6 sm:w-[660px] sm:max-w-[660px]">
          <SheetHeader className="pr-7">
            <SheetTitle>{creating ? "New ISMS control" : editing ? `Edit ${activeControl?.reference ?? "control"}` : activeControl?.title ?? "Control details"}</SheetTitle>
            <SheetDescription>{creating || editing ? "Saving creates a draft revision. Approval is a separate action." : activeControl ? `${activeControl.reference} · ${activeControl.framework} · version ${activeControl.version}` : "Loading control…"}</SheetDescription>
          </SheetHeader>
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {creating || editing ? <ControlForm value={form} onChange={setForm} candidates={candidateMemory} onSubmit={save} busy={busy} /> : activeControl ? (
            <div className="space-y-6 pb-8 text-sm">
              <div className="flex flex-wrap gap-2"><Badge variant={activeControl.governance_state === "approved" ? "secondary" : "outline"}>{activeControl.governance_state}</Badge><Badge variant="outline">{APPLICABILITY[activeControl.applicability]}</Badge><Badge variant="outline">{IMPLEMENTATION[activeControl.implementation_status]}</Badge></div>
              <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objective</p><p className="mt-2 whitespace-pre-wrap leading-6">{activeControl.objective}</p></div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5"><div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1 font-medium">{activeControl.owner}</dd></div><div><dt className="text-xs text-muted-foreground">Review due</dt><dd className="mt-1 font-medium">{activeControl.review_due_on ?? "Not set"}</dd></div><div className="col-span-2"><dt className="text-xs text-muted-foreground">Applicability rationale</dt><dd className="mt-1">{activeControl.applicability_rationale || "Not recorded"}</dd></div></dl>
              <div><p className="font-medium">Assessment evidence ({activeControl.evidence_references.length})</p><p className="mt-1 text-xs text-muted-foreground">Locations recorded by a reviewer; Spur has not verified them.</p><div className="mt-3 border-t">{activeControl.evidence_references.map((reference, index) => <div key={`${reference.locator}-${index}`} className="border-b py-2.5"><p className="font-medium">{reference.label}</p><p className="mt-0.5 break-all text-xs text-muted-foreground">{reference.locator}</p></div>)}{activeControl.evidence_references.length === 0 ? <p className="py-3 text-muted-foreground">No assessment evidence recorded.</p> : null}</div></div>
              <div><p className="font-medium">Mapped model objects ({activeDetail?.linked_memory.length ?? activeControl.linked_memory_ids.length})</p><p className="mt-1 text-xs text-muted-foreground">Mappings are not effectiveness assessments.</p><div className="mt-3 border-t">{activeDetail?.linked_memory.map((item) => <Link key={item.id} href={`/o/${workspace.organization.slug}/model/catalog/${encodeURIComponent(item.id)}`} className="flex justify-between gap-3 border-b py-2.5 hover:underline"><span>{item.title}</span><span className="text-xs text-muted-foreground">{item.kind}</span></Link>)}{activeDetail && activeDetail.linked_memory.length === 0 ? <p className="py-3 text-muted-foreground">No model objects linked.</p> : null}</div></div>
              <div><p className="font-medium">Version history</p><div className="mt-3 border-t">{activeDetail?.revisions.map((revision) => <div key={revision.version} className="flex justify-between gap-3 border-b py-2.5"><span>Version {revision.version} · {revision.control.governance_state}</span><span className="text-xs text-muted-foreground">{revision.actor} · {dateLabel(revision.changed_at)}</span></div>)}</div></div>
              <div className="border-t pt-5"><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!canPropose || busy || !activeDetail} onClick={() => { setForm({ reference: activeControl.reference, framework: activeControl.framework, framework_version: activeControl.framework_version, title: activeControl.title, objective: activeControl.objective, owner: activeControl.owner, applicability: activeControl.applicability, applicability_rationale: activeControl.applicability_rationale, implementation_status: activeControl.implementation_status, review_due_on: activeControl.review_due_on, evidence_references: activeControl.evidence_references, linked_memory_ids: activeControl.linked_memory_ids }); setEditing(true); setError(""); }}><Pencil />Edit</Button>{activeControl.governance_state === "draft" ? <Button disabled={!canApprove || busy || !activeDetail || activeControl.applicability === "undecided"} onClick={() => changeState("approve")}><Check />Approve</Button> : null}</div><p className="mt-2 text-xs text-muted-foreground">Approval requires the matching account permission. It does not certify effectiveness.</p></div>
              <div className="border-t pt-5"><label className="block space-y-1.5 text-xs text-muted-foreground">Type the control ID to archive<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={activeControl.id} /></label><Button className="mt-3" variant="destructive" disabled={!canArchive || busy || confirmation !== activeControl.id} onClick={() => changeState("archive")}><Trash2 />Archive control</Button></div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
