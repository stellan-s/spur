"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { knowledgeGapSchema, type KnowledgeGap } from "@/core/knowledge-gap-types";
import type { Workspace } from "@/core/memory-types";

export function KnowledgeGapDetail({ gap, workspace, canWrite, onClose, onUpdated }: {
  gap: KnowledgeGap;
  workspace: Workspace;
  canWrite: boolean;
  onClose: () => void;
  onUpdated: (gap: KnowledgeGap) => void;
}) {
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [memoryIds, setMemoryIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolving = gap.status === "open";
  const basePath = `/o/${encodeURIComponent(workspace.organization.slug)}`;
  const memoryById = useMemo(() => new Map(workspace.memory.map((item) => [item.id, item])), [workspace.memory]);
  const candidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return workspace.memory.filter((item) =>
      ["accepted", "candidate"].includes(item.state) && !item.metadata.deleted_at && item.metadata.sensitivity !== "restricted" &&
      (!term || `${item.title} ${item.statement} ${item.kind}`.toLocaleLowerCase().includes(term)),
    );
  }, [workspace.memory, query]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/knowledge-gaps/${encodeURIComponent(gap.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-spur-organization": workspace.organization.slug },
        body: JSON.stringify(resolving
          ? { action: "resolve", note, memory_ids: memoryIds, confirmation }
          : { action: "reopen", note }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Knowledge gap could not be updated.");
      }
      onUpdated(knowledgeGapSchema.parse(payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Knowledge gap could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}>
        <SheetHeader className="pr-6">
          <Badge variant="outline" className="mb-2 w-fit">{resolving ? "Open" : "Resolved"}</Badge>
          <SheetTitle>{gap.question}</SheetTitle>
          <SheetDescription>{gap.reason}</SheetDescription>
        </SheetHeader>
        <p className="text-xs text-muted-foreground">Asked {gap.times_asked} {gap.times_asked === 1 ? "time" : "times"} · Last asked {new Date(gap.last_asked_at).toLocaleDateString("en-GB")}</p>

        {canWrite ? (
          <form onSubmit={submit} className="space-y-5 border-t pt-5">
            <div>
              <label htmlFor="gap-resolution-note" className="text-sm font-medium">{resolving ? "How is this question answered now?" : "What is still missing?"}</label>
              <Textarea id="gap-resolution-note" value={note} onChange={(event) => setNote(event.target.value)} minLength={5} maxLength={2000} required disabled={saving} className="mt-2 min-h-24" />
              <p className="mt-2 text-xs text-muted-foreground">Visible to people who can read gaps. Do not include sensitive security details.</p>
            </div>
            {resolving ? (
              <fieldset disabled={saving} className="space-y-3">
                <legend className="text-sm font-medium">Supporting knowledge</legend>
                <p className="text-xs text-muted-foreground">Choose at least one item that answers the question. Resolving does not change its review status.</p>
                {memoryIds.length ? (
                  <div className="flex flex-wrap gap-2" aria-label="Selected supporting knowledge">
                    {memoryIds.map((id) => (
                      <Button key={id} type="button" variant="secondary" size="sm" className="h-auto max-w-full whitespace-normal text-left" onClick={() => setMemoryIds((ids) => ids.filter((value) => value !== id))} aria-label={`Remove ${memoryById.get(id)?.title ?? id}`}>
                        {memoryById.get(id)?.title ?? id} ×
                      </Button>
                    ))}
                  </div>
                ) : null}
                <label htmlFor="gap-memory-search" className="sr-only">Find supporting knowledge</label>
                <Input id="gap-memory-search" placeholder="Find catalog items" value={query} onChange={(event) => setQuery(event.target.value)} />
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {candidates.slice(0, 30).map((item) => (
                    <div key={item.id} className="flex items-start gap-3 border-b p-3 last:border-b-0">
                      <input id={`gap-memory-${item.id}`} type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={memoryIds.includes(item.id)} disabled={!memoryIds.includes(item.id) && memoryIds.length >= 20} onChange={(event) => setMemoryIds((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`gap-memory-${item.id}`} className="block cursor-pointer text-sm font-medium">{item.title}</label>
                        <p className="mt-1 text-xs capitalize text-muted-foreground">{item.kind} · {item.state}</p>
                      </div>
                      <Link href={`${basePath}/model/catalog/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-4" aria-label={`Review ${item.title} in a new tab`}>Review</Link>
                    </div>
                  ))}
                  {!candidates.length ? <p className="p-4 text-sm text-muted-foreground">No eligible catalog items found. Model the missing knowledge first.</p> : null}
                </div>
                {candidates.length > 30 ? <p className="text-xs text-muted-foreground">Showing 30 of {candidates.length}. Search to narrow the list.</p> : null}
              </fieldset>
            ) : null}
            {resolving ? (
              <div>
                <label htmlFor="gap-resolution-confirmation" className="text-sm font-medium">Confirm gap ID</label>
                <Input
                  id="gap-resolution-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={gap.id}
                  autoComplete="off"
                  required
                  disabled={saving}
                  className="mt-2 font-mono"
                />
                <p className="mt-2 text-xs text-muted-foreground">Enter the exact gap ID to confirm that this specific gap is answered.</p>
              </div>
            ) : null}
            {error ? <Alert variant="destructive"><AlertTitle>Could not update gap</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || note.trim().length < 5 || (resolving && (!memoryIds.length || confirmation !== gap.id))}>{saving ? "Saving…" : resolving ? "Resolve gap" : "Reopen gap"}</Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            </div>
          </form>
        ) : null}

        {gap.history.length ? (
          <section className="space-y-4 border-t pt-5" aria-label="Resolution history">
            <h3 className="text-sm font-medium">History</h3>
            {[...gap.history].reverse().map((entry, index) => (
              <div key={index} className="space-y-2 border-l-2 pl-4 text-sm">
                <p className="font-medium">{entry.action === "resolve" ? "Resolved" : "Reopened"}</p>
                <p className="whitespace-pre-wrap break-words">{entry.note}</p>
                {entry.memory_ids.map((id) => {
                  const item = memoryById.get(id);
                  return item ? <Link key={id} href={`${basePath}/model/catalog/${encodeURIComponent(id)}`} className="block text-primary underline underline-offset-4">{item.title}</Link>
                    : <p key={id} className="text-xs text-muted-foreground">Linked catalog item is no longer available.</p>;
                })}
                <p className="break-words text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString("en-GB")} · {entry.actor}</p>
              </div>
            ))}
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
