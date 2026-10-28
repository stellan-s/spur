"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Workspace } from "@/core/memory-types";
import { knowledgeGapFilterSchema, type KnowledgeGap } from "@/core/knowledge-gap-types";
import { KnowledgeGapDetail } from "./knowledge-gap-detail";
import { ModelHeader } from "./model-views";

export function KnowledgeGapsView({ workspace }: { workspace: Workspace }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const status = knowledgeGapFilterSchema.safeParse(searchParams.get("status")).data ?? "open";
  return <KnowledgeGapList key={`${workspace.organization.slug}:${status}`} workspace={workspace} status={status} pathname={pathname} />;
}

function KnowledgeGapList({ workspace, status, pathname }: {
  workspace: Workspace;
  status: "open" | "resolved" | "all";
  pathname: string;
}) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = gaps.find((gap) => gap.id === selectedId);
  const canWrite = workspace.permissions?.includes("knowledge_gaps.write") ?? false;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/knowledge-gaps?status=${status}`, {
      cache: "no-store",
      headers: { "x-spur-organization": workspace.organization.slug },
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error : "Knowledge gaps could not be loaded.");
        }
        if (!cancelled) setGaps((payload as { gaps: KnowledgeGap[] }).gaps);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Knowledge gaps could not be loaded.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspace.organization.slug, status]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return gaps.filter((gap) => (status === "all" || gap.status === status) &&
      (!term || `${gap.question} ${gap.reason}`.toLocaleLowerCase().includes(term)));
  }, [gaps, query, status]);

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <ModelHeader workspace={workspace} active="gaps" />
      <div className="flex flex-wrap items-end justify-between gap-4 border-b py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Knowledge gaps</h2>
          <p className="mt-1 text-sm text-muted-foreground">Questions Ask or MCP could not answer. Resolve them by linking the knowledge that fills the gap.</p>
        </div>
        <div className="relative w-full sm:w-80">
          <label htmlFor="gap-search" className="sr-only">Search knowledge gaps</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="gap-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions or reasons" className="pl-9" />
        </div>
      </div>

      <nav aria-label="Knowledge gap status" className="flex gap-1 border-b py-3">
        {(["open", "resolved", "all"] as const).map((value) => (
          <Button key={value} asChild variant={status === value ? "secondary" : "ghost"} size="sm">
            <Link href={`${pathname}?status=${value}`} scroll={false} aria-current={status === value ? "page" : undefined}>
              {value === "open" ? "Open" : value === "resolved" ? "Resolved" : "All"}
            </Link>
          </Button>
        ))}
      </nav>
      {notice ? <p role="status" className="pt-4 text-sm">{notice}</p> : null}

      {error ? <Alert variant="destructive" className="mt-6"><AlertTitle>Could not load gaps</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {loading ? <p className="py-12 text-sm text-muted-foreground">Loading knowledge gaps…</p> : null}
      {!loading && !error ? (
        <>
          <p className="py-4 text-sm text-muted-foreground">{visible.length} of {gaps.length} questions{gaps.length === 500 ? " · showing the 500 most asked" : ""}</p>
          {visible.length === 0 ? (
            <p className="border-t py-14 text-sm text-muted-foreground">{query.trim() ? "No questions match this search." : status === "resolved" ? "No gaps have been resolved yet." : status === "open" ? "No open knowledge gaps." : "No knowledge gaps have been logged yet."}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Table>
                <TableHeader className="bg-muted/45">
                  <TableRow>
                    <TableHead className="min-w-0 sm:min-w-80">Question</TableHead>
                    <TableHead className="hidden min-w-60 md:table-cell">Why it was logged</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Times asked</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Last asked</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((gap) => (
                    <TableRow key={gap.id}>
                      <TableCell className="max-w-2xl whitespace-normal font-medium">
                        <button type="button" onClick={() => setSelectedId(gap.id)} className="text-left hover:underline focus-visible:underline">{gap.question}</button>
                        {status === "all" ? <Badge variant="outline" className="ml-2">{gap.status === "resolved" ? "Resolved" : "Open"}</Badge> : null}
                        <span className="mt-2 block text-xs font-normal text-muted-foreground sm:hidden">Asked {gap.times_asked} {gap.times_asked === 1 ? "time" : "times"}</span>
                      </TableCell>
                      <TableCell className="hidden max-w-lg whitespace-normal text-muted-foreground md:table-cell">{gap.reason}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{gap.times_asked}</TableCell>
                      <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground sm:table-cell">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(gap.last_asked_at))}</TableCell>
                      <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelectedId(gap.id)}>{canWrite && gap.status === "open" ? "Resolve" : "Details"}</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
      {selected ? (
        <KnowledgeGapDetail
          key={`${workspace.organization.slug}:${selected.id}`}
          gap={selected}
          workspace={workspace}
          canWrite={canWrite}
          onClose={() => setSelectedId(null)}
          onUpdated={(gap) => {
            setGaps((current) => current.map((item) => item.id === gap.id ? gap : item));
            setSelectedId(null);
            setNotice(gap.status === "resolved" ? "Gap resolved. Its resolution is available under Resolved." : "Gap reopened. Its previous resolution remains in history.");
          }}
        />
      ) : null}
    </div>
  );
}
