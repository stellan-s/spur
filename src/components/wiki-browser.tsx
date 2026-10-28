"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Download,
  FileText,
  Link2,
  LoaderCircle,
  Search,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { wikiStateLabel, type Wiki, type WikiItem, type WikiLink } from "@/core/wiki";
import { cn } from "@/lib/utils";

type WikiKind = WikiItem["kind"];
type KindFilter = WikiKind | "all";

const KIND_LABELS: Record<WikiKind, string> = {
  application: "Applications",
  system: "Systems",
  integration: "Integrations",
  information: "Information",
  entity: "Entities",
  capability: "Capabilities",
  process: "Processes",
  control: "Controls",
  decision: "Decisions",
  rule: "Rules",
  observation: "Observations",
};

const KIND_ORDER: WikiKind[] = [
  "capability",
  "process",
  "rule",
  "control",
  "entity",
  "system",
  "integration",
  "application",
  "information",
  "decision",
  "observation",
];

const KIND_SINGULAR: Record<WikiKind, string> = {
  application: "Application",
  system: "System",
  integration: "Integration",
  information: "Information",
  entity: "Entity",
  capability: "Capability",
  process: "Process",
  control: "Control",
  decision: "Decision",
  rule: "Rule",
  observation: "Observation",
};

function singularKind(kind: WikiKind): string {
  return KIND_SINGULAR[kind];
}

function statusVariant(item: WikiItem): "success" | "warning" | "outline" {
  if (item.state === "accepted") return "success";
  if (item.state === "candidate") return "warning";
  return "outline";
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}

function articleHref(basePath: string, id: string): string {
  return `${basePath}/wiki/${encodeURIComponent(id)}`;
}

function byTitle(left: WikiItem, right: WikiItem): number {
  return left.title.localeCompare(right.title);
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type Connection = {
  link: WikiLink;
  related: WikiItem;
  direction: "incoming" | "outgoing";
};

function DirectoryRow({
  article,
  basePath,
  active,
}: {
  article: WikiItem;
  basePath: string;
  active: boolean;
}) {
  return (
    <Link
      href={articleHref(basePath, article.id)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-muted/60",
        active && "bg-muted",
      )}
    >
      <span className={cn(
        "mt-1.5 size-1.5 shrink-0 rounded-full",
        article.state === "accepted" ? "bg-emerald-600" : "bg-amber-500",
      )} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-5">{article.title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {singularKind(article.kind)} · {wikiStateLabel(article.state)}
        </span>
      </span>
      <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </Link>
  );
}

function RelatedRows({
  title,
  items,
  basePath,
}: {
  title: string;
  items: WikiItem[];
  basePath: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="border-t pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <div className="mt-2 divide-y">
        {items.slice(0, 6).map((item) => (
          <Link
            key={item.id}
            href={articleHref(basePath, item.id)}
            className="group flex items-center justify-between gap-4 py-2.5 text-sm transition-colors hover:text-primary"
          >
            <span className="min-w-0 truncate">{item.title}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ))}
      </div>
      {items.length > 6 ? <p className="mt-2 text-xs text-muted-foreground">Showing 6 of {items.length} related pages.</p> : null}
    </section>
  );
}

function WikiHome({ wiki, basePath, setKind }: { wiki: Wiki; basePath: string; setKind: (kind: KindFilter) => void }) {
  const confirmed = wiki.articles.filter((article) => article.state === "accepted").length;
  const capabilities = wiki.articles.filter((article) => article.kind === "capability").sort(byTitle);
  return (
    <div className="mx-auto max-w-5xl px-6 py-10 sm:px-10 lg:py-14">
      <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Knowledge home</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          What {wiki.organization.name} knows
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          Browse one page at a time. Every article comes from the live organisational model and links back to its evidence and related knowledge.
        </p>
        <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-y py-4 text-sm">
          <span><strong className="font-semibold tabular-nums">{wiki.articles.length}</strong> pages</span>
          <span><strong className="font-semibold tabular-nums">{confirmed}</strong> confirmed</span>
          <span><strong className="font-semibold tabular-nums">{wiki.links.length}</strong> connections</span>
        </div>
      </div>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Start here</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Capabilities</h2>
          </div>
          <button type="button" onClick={() => setKind("capability")} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Browse all
          </button>
        </div>
        <div className="grid divide-y md:grid-cols-2 md:gap-x-10 md:[&>*:nth-child(2)]:border-t">
          {capabilities.slice(0, 6).map((article) => (
            <Link key={article.id} href={articleHref(basePath, article.id)} className="group py-4">
              <span className="flex items-center justify-between gap-4">
                <span className="font-medium group-hover:text-primary">{article.title}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{article.statement}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t pt-6">
        <h2 className="text-sm font-semibold">Browse by page type</h2>
        <div className="mt-4 grid grid-cols-2 gap-x-8 sm:grid-cols-3">
          {KIND_ORDER.map((kind) => {
            const count = wiki.articles.filter((article) => article.kind === kind).length;
            if (count === 0) return null;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setKind(kind)}
                className="flex items-center justify-between border-b py-3 text-left text-sm transition-colors hover:text-primary"
              >
                <span>{KIND_LABELS[kind]}</span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function WikiArticle({
  article,
  wiki,
  basePath,
}: {
  article: WikiItem;
  wiki: Wiki;
  basePath: string;
}) {
  const byId = new Map(wiki.articles.map((candidate) => [candidate.id, candidate]));
  const connections = wiki.links.flatMap<Connection>((link): Connection[] => {
    if (link.from_id === article.id) {
      const related = byId.get(link.to_id);
      return related ? [{ link, related, direction: "outgoing" }] : [];
    }
    if (link.to_id === article.id) {
      const related = byId.get(link.from_id);
      return related ? [{ link, related, direction: "incoming" }] : [];
    }
    return [];
  }).sort((left, right) => left.related.title.localeCompare(right.related.title));
  const capability = article.kind === "capability"
    ? wiki.capabilities.find((section) => section.capability.id === article.id)
    : undefined;

  return (
    <article key={article.id} className="mx-auto max-w-4xl animate-in fade-in slide-in-from-bottom-1 px-6 py-9 duration-300 sm:px-10 lg:py-12">
      <nav className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href={`${basePath}/wiki`} className="hover:text-foreground">Wiki</Link>
        <ChevronRight className="size-3" aria-hidden="true" />
        <span>{singularKind(article.kind)}</span>
      </nav>

      <header className="mt-6 border-b pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-normal">{singularKind(article.kind)}</Badge>
          <Badge variant={statusVariant(article)} className="font-normal">{wikiStateLabel(article.state)}</Badge>
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{article.title}</h1>
      </header>

      <section id="overview" className="scroll-mt-6 py-8">
        <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Overview</h2>
        <p className="mt-4 max-w-3xl text-base leading-8 text-foreground/90">{article.statement}</p>
        {article.subjects.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {article.subjects.slice(0, 10).map((subject) => <span key={subject} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{subject}</span>)}
          </div>
        ) : null}
      </section>

      {capability ? (
        <div id="related-pages" className="scroll-mt-6 grid gap-x-10 md:grid-cols-2">
          <RelatedRows title="Processes" items={capability.processes} basePath={basePath} />
          <RelatedRows title="Rules" items={capability.rules} basePath={basePath} />
          <RelatedRows title="Controls" items={capability.controls} basePath={basePath} />
          <RelatedRows title="Entities" items={capability.entities} basePath={basePath} />
        </div>
      ) : connections.length > 0 ? (
        <section id="related-pages" className="scroll-mt-6 border-t py-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">Related pages</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{connections.length}</span>
          </div>
          <div className="mt-3 divide-y border-y">
            {connections.slice(0, 24).map(({ link, related, direction }) => (
              <Link key={`${link.id}-${direction}`} href={articleHref(basePath, related.id)} className="group grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium group-hover:text-primary">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{related.title}</span>
                </span>
                <span className="text-xs text-muted-foreground sm:text-right">
                  {direction === "incoming" ? "Linked from · " : "Links to · "}{label(link.predicate)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section id="evidence" className="scroll-mt-6 border-t py-7">
        <h2 className="text-lg font-semibold tracking-tight">Evidence and provenance</h2>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Evidence references</p>
            <p className="mt-1 font-medium tabular-nums">{article.evidence_ids.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Authority</p>
            <p className="mt-1 font-medium">{label(article.authority)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="mt-1 font-medium tabular-nums">{Math.round(article.confidence * 100)}%</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link href={`${basePath}/model/catalog/${encodeURIComponent(article.id)}`}>
            <FileText aria-hidden="true" /> Inspect evidence and source record
          </Link>
        </Button>
      </section>
    </article>
  );
}

function PageContext({ article, wiki, basePath }: { article: WikiItem; wiki: Wiki; basePath: string }) {
  const byId = new Map(wiki.articles.map((candidate) => [candidate.id, candidate]));
  const backlinks = wiki.links
    .filter((link) => link.to_id === article.id)
    .map((link) => ({ link, article: byId.get(link.from_id) }))
    .filter((entry): entry is { link: WikiLink; article: WikiItem } => Boolean(entry.article))
    .sort((left, right) => left.article.title.localeCompare(right.article.title));
  return (
    <aside className="hidden min-h-0 overflow-y-auto border-l px-5 py-7 xl:block">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">On this page</p>
      <nav className="mt-3 space-y-1 text-sm">
        <a href="#overview" className="block py-1 text-muted-foreground hover:text-foreground">Overview</a>
        <a href="#related-pages" className="block py-1 text-muted-foreground hover:text-foreground">Related pages</a>
        <a href="#evidence" className="block py-1 text-muted-foreground hover:text-foreground">Evidence</a>
      </nav>
      <div className="mt-7 border-t pt-5">
        <p className="text-xs text-muted-foreground">Last updated</p>
        <p className="mt-1 text-sm">{new Date(article.updated_at).toLocaleDateString()}</p>
      </div>
      <div className="mt-7 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Backlinks</p>
          <span className="text-xs tabular-nums text-muted-foreground">{backlinks.length}</span>
        </div>
        {backlinks.length > 0 ? (
          <div className="mt-3 space-y-3">
            {backlinks.slice(0, 10).map(({ link, article: backlink }) => (
              <Link key={link.id} href={articleHref(basePath, backlink.id)} className="block text-sm leading-5 hover:text-primary">
                {backlink.title}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{label(link.predicate)}</span>
              </Link>
            ))}
          </div>
        ) : <p className="mt-3 text-xs leading-5 text-muted-foreground">No pages link here yet.</p>}
      </div>
    </aside>
  );
}

export function WikiView({
  organizationId,
  initialPageId,
  canExport,
}: {
  organizationId: string;
  initialPageId: string;
  canExport: boolean;
}) {
  const [wiki, setWiki] = useState<Wiki | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [kindOverride, setKindOverride] = useState<KindFilter | null>(null);
  const basePath = `/o/${organizationId}`;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wiki", {
      cache: "no-store",
      headers: { "x-spur-organization": organizationId },
    }).then(async (response) => {
      const payload = await response.json() as Wiki | { error?: string };
      if (!response.ok) throw new Error("error" in payload ? payload.error : "The wiki could not be loaded.");
      if (!cancelled) setWiki(payload as Wiki);
    }).catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "The wiki could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [organizationId]);

  const selected = wiki?.articles.find((article) => article.id === initialPageId);
  const activeKind: KindFilter = kindOverride ?? selected?.kind ?? "capability";
  const counts = useMemo(() => {
    const result = new Map<WikiKind, number>();
    for (const article of wiki?.articles ?? []) result.set(article.kind, (result.get(article.kind) ?? 0) + 1);
    return result;
  }, [wiki]);
  const filtered = useMemo(() => {
    if (!wiki) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return wiki.articles.filter((article) =>
      (activeKind === "all" || article.kind === activeKind) &&
      (!normalized || `${article.title} ${article.statement} ${article.subjects.join(" ")}`.toLocaleLowerCase().includes(normalized)),
    ).slice(0, 100);
  }, [activeKind, query, wiki]);

  async function exportMarkdown(article?: WikiItem) {
    setExporting(true);
    setError("");
    try {
      const params = new URLSearchParams({ format: "markdown" });
      if (article) params.set("page", article.id);
      const response = await fetch(`/api/wiki?${params}`, {
        headers: { "x-spur-organization": organizationId },
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "The wiki could not be exported.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${organizationId}-${article ? slug(article.title) || "page" : "wiki"}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The wiki could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  if (error && !wiki) {
    return <div className="p-6 sm:p-9"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>;
  }
  if (!wiki) {
    return <div className="flex min-h-[50vh] items-center justify-center"><LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Loading wiki" /></div>;
  }

  return (
    <div className="flex min-h-0 w-full flex-col md:h-svh md:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link href={`${basePath}/wiki`} className="block truncate text-sm font-semibold hover:text-primary">{wiki.organization.name} wiki</Link>
            <p className="text-xs text-muted-foreground">{wiki.articles.length} connected pages</p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&>*]:shrink-0 [&::-webkit-scrollbar]:hidden sm:w-auto">
          <Button asChild variant="ghost" size="sm"><Link href={`${basePath}/model`}><ArrowLeft aria-hidden="true" />Back to workspace</Link></Button>
          {selected ? <Button asChild variant="ghost" size="sm"><Link href={`${basePath}/wiki`}><ArrowLeft aria-hidden="true" />Wiki home</Link></Button> : null}
          {canExport ? (
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportMarkdown(selected)}>
              {exporting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {selected ? "Export page" : "Export wiki"}
            </Button>
          ) : null}
        </div>
      </header>
      {error ? <Alert variant="destructive" className="m-4"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_250px]">
        <aside className="flex min-h-0 flex-col border-b bg-muted/15 md:border-r md:border-b-0">
          <div className="space-y-3 border-b p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search wiki" className="bg-background pl-9 shadow-none" />
            </div>
            <select
              value={activeKind}
              onChange={(event) => setKindOverride(event.target.value as KindFilter)}
              className="border-input h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
              aria-label="Page type"
            >
              <option value="all">All page types · {wiki.articles.length}</option>
              {KIND_ORDER.filter((candidate) => (counts.get(candidate) ?? 0) > 0).map((candidate) => (
                <option key={candidate} value={candidate}>{KIND_LABELS[candidate]} · {counts.get(candidate)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between border-b px-4 py-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            <span>{activeKind === "all" ? "Pages" : KIND_LABELS[activeKind]}</span>
            <span className="tabular-nums">{filtered.length}{filtered.length === 100 ? "+" : ""}</span>
          </div>
          <nav className={cn("min-h-0 overflow-y-auto md:max-h-none md:flex-1", selected ? "max-h-44" : "max-h-72")} aria-label="Wiki pages">
            {filtered.map((article) => <DirectoryRow key={article.id} article={article} basePath={basePath} active={article.id === selected?.id} />)}
            {filtered.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No pages match this search.</p> : null}
          </nav>
        </aside>

        <main className="min-h-0 overflow-y-auto scroll-smooth">
          {selected ? <WikiArticle article={selected} wiki={wiki} basePath={basePath} /> : initialPageId ? (
            <div className="mx-auto max-w-xl px-6 py-16 text-center">
              <FileText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
              <h1 className="mt-4 text-xl font-semibold">Wiki page not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">The page may have been archived or merged.</p>
              <Button asChild variant="outline" className="mt-5"><Link href={`${basePath}/wiki`}>Return to wiki home</Link></Button>
            </div>
          ) : <WikiHome wiki={wiki} basePath={basePath} setKind={setKindOverride} />}
        </main>

        {selected ? <PageContext article={selected} wiki={wiki} basePath={basePath} /> : (
          <aside className="hidden border-l px-5 py-7 xl:block">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">About this wiki</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Pages update with Spur memory. Confirmed and candidate knowledge remain visibly distinct.
            </p>
            <div className="mt-6 border-t pt-5 text-xs leading-5 text-muted-foreground">
              Last generated<br />{new Date(wiki.generated_at).toLocaleString()}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
