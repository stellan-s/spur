"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Search,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { MemoryObject, Workspace } from "@/core/memory-types";
import {
  isProductDocument,
  productDocumentPath,
  productDocumentType,
  type ProductDocumentType,
} from "@/core/product-document";
import { cn } from "@/lib/utils";

type DocumentFilter = ProductDocumentType | "all";

function apiError(payload: unknown, fallback: string): string {
  return payload !== null && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function documentLabel(type: ProductDocumentType): string {
  return type === "prd" ? "PRD" : "Technical specification";
}

function documentStatus(item: MemoryObject): { label: string; variant: "success" | "warning" | "outline" } {
  if (item.state === "accepted") return { label: "Approved", variant: "success" };
  if (item.state === "candidate") return { label: "Draft", variant: "warning" };
  if (item.state === "disputed") return { label: "Disputed", variant: "outline" };
  return { label: "Stale", variant: "outline" };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function safeLinkTarget(value: string): string | null {
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function InlineMarkdown({ text }: { text: string }) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(<code key={index} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={index} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeLinkTarget(link[2]) : null;
      parts.push(href ? (
        <a key={index} href={href} className="font-medium text-primary underline underline-offset-4" target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
          {link?.[1]}
        </a>
      ) : token);
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; text: string }
  | { type: "rule" };

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  const special = (line: string) =>
    /^#{1,6}\s+/.test(line) || /^```/.test(line) || /^>\s?/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^---+$/.test(line.trim());

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    const fence = /^```([^`]*)$/.exec(line.trim());
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1].trim(), text: code.join("\n") });
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join(" ") });
      continue;
    }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      const pattern = isOrdered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/;
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !special(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function MarkdownDocument({ content }: { content: string }) {
  return (
    <div className="max-w-4xl text-[15px] leading-7 text-muted-foreground">
      {parseMarkdown(content).map((block, index) => {
        if (block.type === "heading") {
          const className = cn(
            "font-semibold tracking-tight text-foreground",
            block.level === 1 && "mb-4 mt-10 text-3xl first:mt-0",
            block.level === 2 && "mb-3 mt-9 border-t pt-7 text-xl",
            block.level >= 3 && "mb-2 mt-7 text-base",
          );
          if (block.level === 1) return <h2 key={index} className={className}><InlineMarkdown text={block.text} /></h2>;
          if (block.level === 2) return <h3 key={index} className={className}><InlineMarkdown text={block.text} /></h3>;
          return <h4 key={index} className={className}><InlineMarkdown text={block.text} /></h4>;
        }
        if (block.type === "paragraph") return <p key={index} className="my-4"><InlineMarkdown text={block.text} /></p>;
        if (block.type === "quote") return <blockquote key={index} className="my-5 border-l-2 border-primary/40 pl-4 italic"><InlineMarkdown text={block.text} /></blockquote>;
        if (block.type === "rule") return <hr key={index} className="my-8 border-border" />;
        if (block.type === "code") return (
          <pre key={index} className="my-5 overflow-x-auto rounded-lg border bg-muted/45 p-4 font-mono text-xs leading-6 text-foreground">
            {block.language ? <span className="mb-2 block text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{block.language}</span> : null}
            <code>{block.text}</code>
          </pre>
        );
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={cn("my-4 space-y-2 pl-6", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, itemIndex) => {
              const task = /^\[([ xX])\]\s+(.+)$/.exec(item);
              return (
                <li key={itemIndex} className={task ? "list-none -ml-6 flex gap-2" : undefined}>
                  {task ? <span className={cn("mt-1 flex size-4 shrink-0 items-center justify-center rounded border", task[1].trim() && "border-primary bg-primary text-primary-foreground")}>{task[1].trim() ? <Check className="size-3" aria-hidden="true" /> : null}</span> : null}
                  <span><InlineMarkdown text={task ? task[2] : item} /></span>
                </li>
              );
            })}
          </List>
        );
      })}
    </div>
  );
}

export function ProductDocuments({
  workspace,
  initialDocumentId = "",
  initialType = "all",
  initialQuery = "",
  onRefresh,
}: {
  workspace: Workspace;
  initialDocumentId?: string;
  initialType?: string;
  initialQuery?: string;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const basePath = `/o/${workspace.organization.slug}`;
  const filter: DocumentFilter = initialType === "prd" || initialType === "spec" ? initialType : "all";
  const documents = workspace.memory
    .filter(isProductDocument)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const selected = initialDocumentId ? documents.find((item) => item.id === initialDocumentId) : undefined;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "approve" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const [title, setTitle] = useState(selected?.title ?? "");
  const [type, setType] = useState<ProductDocumentType>(productDocumentType(selected ?? { metadata: {} }) ?? "prd");
  const [content, setContent] = useState(selected?.statement ?? "");
  const [restrictDocument, setRestrictDocument] = useState(selected?.metadata.sensitivity === "restricted");

  const normalizedQuery = initialQuery.trim().toLocaleLowerCase();
  const visible = documents.filter((item) => {
    const itemType = productDocumentType(item);
    if (filter !== "all" && itemType !== filter) return false;
    return !normalizedQuery || `${item.title} ${item.statement}`.toLocaleLowerCase().includes(normalizedQuery);
  });

  async function updateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy("save");
    setError(null);
    try {
      const response = await fetch(`/api/product-documents/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify({
          document_type: type,
          title,
          content,
          related_ids: Array.isArray(selected.metadata.related_ids) ? selected.metadata.related_ids : [],
          ...(restrictDocument ? { sensitivity: "restricted" } : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Document could not be saved."));
      await onRefresh();
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function manageDocument(action: "promote" | "archive") {
    if (!selected || busy) return;
    setBusy(action === "promote" ? "approve" : "archive");
    setError(null);
    try {
      const response = await fetch(`/api/memory/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-spur-organization": workspace.organization.slug,
        },
        body: JSON.stringify(action === "promote"
          ? { action: "promote" }
          : { action: "archive", confirmation: archiveConfirmation }),
      });
      const payload: unknown = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(apiError(payload, `Document could not be ${action === "promote" ? "approved" : "archived"}.`));
      await onRefresh();
      if (action === "archive") router.push(`${basePath}/documents`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Document could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  if (initialDocumentId && !selected) {
    return (
      <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
        <Button asChild variant="ghost" className="-ml-3"><Link href={`${basePath}/documents`}><ArrowLeft aria-hidden="true" />Product documents</Link></Button>
        <Alert variant="destructive" className="mt-8 max-w-2xl">
          <AlertTitle>Document unavailable</AlertTitle>
          <AlertDescription>The document does not exist in this organisation or you do not have access to it.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (selected) {
    const selectedType = productDocumentType(selected) ?? "prd";
    const status = documentStatus(selected);
    const relatedIds = Array.isArray(selected.metadata.related_ids)
      ? selected.metadata.related_ids.filter((id): id is string => typeof id === "string")
      : [];
    const related = relatedIds
      .map((id) => workspace.memory.find((item) => item.id === id))
      .filter((item): item is MemoryObject => item !== undefined && !isProductDocument(item));
    const canEdit = workspace.permissions?.includes("memory.edit") === true;
    const canApprove = workspace.permissions?.includes("memory.promote") === true && selected.state === "candidate";
    const canArchive = workspace.permissions?.includes("memory.archive") === true;
    const canRestrict = workspace.permissions?.includes("restricted.write") === true;

    return (
      <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
        <nav aria-label="Breadcrumb" className="border-b pb-4">
          <Link href={`${basePath}/documents`} className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" /> Product documents
          </Link>
        </nav>

        <header className="border-b py-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-4xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-normal">{documentLabel(selectedType)}</Badge>
                <Badge variant={status.variant} className="font-normal">{status.label}</Badge>
                {selected.metadata.sensitivity === "restricted" ? <Badge variant="outline" className="gap-1.5 font-normal"><LockKeyhole className="size-3" aria-hidden="true" />Restricted</Badge> : null}
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{selected.title}</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Updated {formatDate(selected.updated_at)}{selected.actor ? ` by ${selected.actor}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit ? <Button type="button" variant="outline" onClick={() => setEditing((value) => !value)}><Pencil aria-hidden="true" />{editing ? "Close editor" : "Edit"}</Button> : null}
              {canApprove ? <Button type="button" onClick={() => void manageDocument("promote")} disabled={busy !== null}>{busy === "approve" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}Approve document</Button> : null}
            </div>
          </div>
        </header>

        {error ? <Alert variant="destructive" className="mt-6 max-w-4xl"><AlertTitle>Document update failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

        {editing ? (
          <form onSubmit={updateDocument} className="max-w-5xl border-b py-8">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <label htmlFor="document-title" className="mb-1.5 block text-sm font-medium">Title</label>
                <Input id="document-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} maxLength={160} />
              </div>
              <div>
                <label htmlFor="document-type" className="mb-1.5 block text-sm font-medium">Document type</label>
                <select id="document-type" value={type} onChange={(event) => setType(event.target.value as ProductDocumentType)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="prd">PRD</option>
                  <option value="spec">Technical specification</option>
                </select>
              </div>
            </div>
            <div className="mt-5">
              <label htmlFor="document-content" className="mb-1.5 block text-sm font-medium">Markdown content</label>
              <Textarea id="document-content" value={content} onChange={(event) => setContent(event.target.value)} required minLength={5} maxLength={12_000} className="min-h-[480px] font-mono text-sm leading-6" />
              <p className="mt-1.5 text-right text-xs text-muted-foreground">{content.length.toLocaleString()} / 12,000</p>
            </div>
            {selected.state === "accepted" ? <p className="mt-4 text-sm text-muted-foreground">Saving changes returns this approved document to Draft until it is approved again.</p> : null}
            {canRestrict || restrictDocument ? (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={restrictDocument} disabled={selected.metadata.sensitivity === "restricted" || !canRestrict} onChange={(event) => setRestrictDocument(event.target.checked)} className="size-4 rounded border-input" />
                Restrict this document to users with restricted-data access
              </label>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button type="submit" disabled={busy !== null}>{busy === "save" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}Save changes</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <article className="grid gap-10 py-8 xl:grid-cols-[minmax(0,880px)_minmax(240px,1fr)]">
            <MarkdownDocument content={selected.statement} />
            <aside className="border-t pt-6 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
              <h2 className="text-sm font-semibold">Related knowledge</h2>
              {related.length ? (
                <div className="mt-3 border-t">
                  {related.map((item) => (
                    <Link key={item.id} href={`${basePath}/model/catalog/${encodeURIComponent(item.id)}`} className="block border-b py-3 text-sm transition-colors hover:text-primary">
                      <span className="font-medium">{item.title}</span>
                      <span className="mt-1 block text-xs capitalize text-muted-foreground">{item.kind}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="mt-2 text-sm leading-6 text-muted-foreground">No catalog knowledge is linked to this document.</p>}
            </aside>
          </article>
        )}

        {canArchive ? (
          <section className="mt-8 max-w-4xl border-t py-8" aria-labelledby="archive-document-heading">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h2 id="archive-document-heading" className="text-sm font-semibold">Archive document</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Archived documents disappear from Product documents and MCP retrieval but remain recoverable in the audit store.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setConfirmArchive((value) => !value)}><Archive aria-hidden="true" />Archive</Button>
            </div>
            {confirmArchive ? (
              <div className="mt-5 max-w-xl border-l-2 border-destructive/50 pl-4">
                <label htmlFor="archive-confirmation" className="text-sm font-medium">Type <code className="rounded bg-muted px-1 py-0.5 text-xs">{selected.id}</code> to confirm</label>
                <div className="mt-2 flex gap-2">
                  <Input id="archive-confirmation" value={archiveConfirmation} onChange={(event) => setArchiveConfirmation(event.target.value)} />
                  <Button type="button" variant="destructive" disabled={archiveConfirmation !== selected.id || busy !== null} onClick={() => void manageDocument("archive")}>{busy === "archive" ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Archive aria-hidden="true" />}Archive</Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  const filterHref = (nextFilter: DocumentFilter) => {
    const params = new URLSearchParams();
    if (nextFilter !== "all") params.set("type", nextFilter);
    if (initialQuery.trim()) params.set("q", initialQuery.trim());
    return `${basePath}/documents${params.size ? `?${params.toString()}` : ""}`;
  };
  const counts = {
    all: documents.length,
    prd: documents.filter((item) => productDocumentType(item) === "prd").length,
    spec: documents.filter((item) => productDocumentType(item) === "spec").length,
  };

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <header className="border-b pb-7">
        <div className="flex items-start gap-4">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-primary"><FileText className="size-5" aria-hidden="true" /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Product documents</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">PRDs and technical specifications saved by connected AI agents for this organisation.</p>
          </div>
        </div>
      </header>

      <nav aria-label="Document types" className="flex gap-5 overflow-x-auto border-b" >
        {([
          { id: "all" as const, label: "All" },
          { id: "prd" as const, label: "PRDs" },
          { id: "spec" as const, label: "Technical specifications" },
        ]).map((item) => (
          <Link key={item.id} href={filterHref(item.id)} aria-current={filter === item.id ? "page" : undefined} className={cn("relative flex h-12 shrink-0 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground", "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform", filter === item.id && "font-medium text-foreground after:scale-x-100")}>
            {item.label}<span className="text-xs tabular-nums text-muted-foreground">{counts[item.id]}</span>
          </Link>
        ))}
      </nav>

      <form action={`${basePath}/documents`} method="get" className="flex flex-wrap items-end gap-3 border-b py-5">
        <div className="min-w-0 flex-1 basis-full sm:min-w-[260px] sm:basis-auto">
          <label htmlFor="document-query" className="mb-1.5 block text-xs font-medium text-muted-foreground">Search documents</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="document-query" name="q" defaultValue={initialQuery} placeholder="Title or requirement" className="pl-9" />
          </div>
        </div>
        {filter !== "all" ? <input type="hidden" name="type" value={filter} /> : null}
        <Button type="submit">Apply</Button>
        {initialQuery ? <Button asChild variant="ghost"><Link href={filterHref(filter).split("?")[0] + (filter !== "all" ? `?type=${filter}` : "")}>Clear search</Link></Button> : null}
      </form>

      <div className="flex items-center justify-between gap-4 py-4 text-sm text-muted-foreground">
        <p>{visible.length} of {documents.length} documents</p>
      </div>

      {visible.length ? (
        <div className="overflow-hidden rounded-md border bg-card">
          <Table>
            <TableHeader className="bg-muted/45">
              <TableRow className="hover:bg-muted/45">
                <TableHead className="min-w-0 sm:min-w-[320px]">Document</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => {
                const itemType = productDocumentType(item) ?? "prd";
                const status = documentStatus(item);
                return (
                  <TableRow key={item.id} className="group">
                    <TableCell className="whitespace-normal">
                      <Link href={productDocumentPath(workspace.organization.slug, item.id)} className="font-medium transition-colors group-hover:text-primary group-hover:underline group-hover:underline-offset-4">{item.title}</Link>
                      <p className="mt-1 line-clamp-2 max-w-3xl text-xs leading-5 text-muted-foreground">{item.statement.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim()}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
                        <Badge variant="outline" className="font-normal">{documentLabel(itemType)}</Badge>
                        <Badge variant={status.variant} className="font-normal">{status.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="font-normal">{documentLabel(itemType)}</Badge></TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant={status.variant} className="font-normal">{status.label}</Badge></TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">{formatDate(item.updated_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <section className="border-t py-16 text-center">
          <FileText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-sm font-semibold">{documents.length ? "No documents match the filters" : "No product documents yet"}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{documents.length ? "Change the document type or search terms." : "Use the spur-write-requirements skill with a connected AI agent, then approve its draft for saving in Spur."}</p>
        </section>
      )}
    </div>
  );
}
