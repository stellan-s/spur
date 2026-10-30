"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Bot,
  Building2,
  Boxes,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Database,
  FileText,
  FileSearch,
  GitBranch,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  Menu,
  Monitor,
  Moon,
  Network,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TopLoadingBar } from "@/components/ui/top-loading-bar";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type {
  Conversation,
  InvestigationResult,
  MemoryObject,
  Source,
  Workspace,
} from "@/core/memory-types";
import { isProductDocument, productDocumentPath } from "@/core/product-document";
import { signInPath } from "@/core/public-url";
import { cn } from "@/lib/utils";
import { EvidenceItem } from "./evidence-item";
import { GuideModelReference } from "./guide-model-reference";
import { ModelEntityDetail } from "./model-entity-detail";
import { ModelCatalog, ModelHealth, ModelOverview } from "./model-views";
import { KnowledgeGapsView } from "./knowledge-gaps-view";
import { IsmsCatalog } from "./isms-catalog";
import { WikiView } from "./wiki-browser";
import { AdminAccess } from "./admin-access";
import { NavigationProgress } from "./navigation-progress";
import { WorkspaceLoading } from "./workspace-loading";
import { RemoveSourceButton } from "./remove-source-button";
import { ProductDocuments } from "./product-documents";
import { isAuthenticatedSession, useWorkspaceState, type WorkspaceView } from "./workspace-state";

type View = "ask" | "model" | "catalog" | "entity" | "health" | "gaps" | "documents" | "document" | "sources" | "guide" | "isms" | "wiki" | "admin";
type ThemePreference = "system" | "light" | "dark";

type ConfiguredOrganization = {
  slug: string;
  name: string;
  requires_authentication: boolean;
};

function organizationHeaders(slug: string, json = false): HeadersInit {
  return {
    "x-spur-organization": slug,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

const INVESTIGATION_STEPS = [
  { pending: "Recall organizational memory", running: "Recalling organizational memory", complete: "Recalled organizational memory", icon: Search },
  { pending: "Investigate the connected repository", running: "Investigating the connected repository", complete: "Investigated the connected repository", icon: FileSearch },
  { pending: "Verify source evidence", running: "Verifying source evidence", complete: "Verified source evidence", icon: ShieldCheck },
  { pending: "Keep the catalog unchanged", running: "Keeping the catalog unchanged", complete: "Kept the catalog unchanged", icon: Database },
] as const;

const KIND_LABELS: Record<MemoryObject["kind"], string> = {
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

function MemoryState({ item }: { item: MemoryObject }) {
  const label =
    item.state === "accepted"
      ? "Accepted"
      : item.state === "candidate"
        ? "Candidate"
        : item.state === "disputed"
          ? "Disputed"
          : "Stale";
  return (
    <Badge
      variant={item.state === "accepted" ? "success" : item.state === "candidate" ? "warning" : "outline"}
      className="font-normal"
    >
      {label}
    </Badge>
  );
}

function MemoryRow({ item, compact = false }: { item: MemoryObject; compact?: boolean }) {
  return (
    <article className="group grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[108px_minmax(0,1fr)_auto] sm:items-start">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {KIND_LABELS[item.kind]}
      </p>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium">{item.title}</h3>
        <p className={cn("mt-1 text-sm leading-6 text-muted-foreground", compact && "line-clamp-2")}>
          {item.statement}
        </p>
        {!compact ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {item.actor ? `${item.actor} · ` : ""}
            {item.authority.replace("_", " ")} · {Math.round(item.confidence * 100)}% confidence
          </p>
        ) : null}
      </div>
      <MemoryState item={item} />
    </article>
  );
}

function TruthRow({
  tone,
  label,
  title,
  body,
  meta,
}: {
  tone: "observed" | "known" | "verified" | "uncertain";
  label: string;
  title: string;
  body: string;
  meta?: string;
}) {
  const Icon =
    tone === "verified"
      ? ShieldCheck
      : tone === "known"
        ? CheckCircle2
        : tone === "observed"
          ? Braces
          : CircleHelp;
  return (
    <section className="grid gap-3 border-b py-5 last:border-b-0 sm:grid-cols-[156px_minmax(0,1fr)]">
      <div className="flex items-start gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="mt-0.5 size-4" aria-hidden="true" />
        {label}
      </div>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
        {meta ? <p className="mt-2 text-xs text-muted-foreground">{meta}</p> : null}
      </div>
    </section>
  );
}

function Navigation({ view, basePath, permissions, featureValues, onNavigate }: {
  view: View;
  basePath: string;
  permissions: string[];
  featureValues: Workspace["features"];
  onNavigate?: () => void;
}) {
  const items = [
    { id: "ask" as const, label: "Ask Spur", icon: Sparkles, permission: "memory.ask", enabled: featureValues?.ask !== false },
    { id: "model" as const, label: "Model", icon: Boxes, permission: "memory.read", enabled: true },
    { id: "documents" as const, label: "Product documents", icon: FileText, permission: "memory.read", enabled: true },
    { id: "wiki" as const, label: "Wiki", icon: BookOpen, permission: "wiki.read", enabled: featureValues?.wiki !== false },
    { id: "isms" as const, label: "ISMS controls", icon: ShieldCheck, permission: "isms.read", enabled: featureValues?.isms !== false },
    { id: "sources" as const, label: "Sources", icon: Network, permission: "memory.read", enabled: true },
    { id: "admin" as const, label: "Administration", icon: LockKeyhole, permission: "users.manage", enabled: true },
    { id: "guide" as const, label: "Guide", icon: BookOpen, permission: null, enabled: true },
  ].filter((item) => item.enabled && (item.permission === null || permissions.includes(item.permission)));
  const isActive = (id: (typeof items)[number]["id"]) =>
    view === id ||
    (id === "model" && ["catalog", "health", "gaps", "entity"].includes(view)) ||
    (id === "documents" && view === "document");
  return (
    <nav className="flex w-max min-w-full gap-1 pb-1 md:w-auto md:min-w-0 md:flex-col md:pb-0" aria-label="Workspace">
      {items.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          asChild
          variant={isActive(id) ? "secondary" : "ghost"}
          className={cn(
            "justify-start gap-2.5 font-normal",
            isActive(id) && "bg-brand-tint text-foreground",
          )}
        >
          <Link
            href={`${basePath}/${id === "isms" ? "isms/controls" : id}`}
            aria-current={isActive(id) ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            {label}
            <NavigationProgress />
          </Link>
        </Button>
      ))}
    </nav>
  );
}

function ThemePicker({ preference, onChange }: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const options = [
    { value: "system" as const, label: "System", icon: Monitor },
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
  ];
  const ActiveIcon = options.find((option) => option.value === preference)?.icon ?? Monitor;
  return (
    <details
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={`Appearance: ${preference}`}
        title="Appearance"
        className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <ActiveIcon className="size-4" aria-hidden="true" />
      </summary>
      <div className="absolute bottom-full right-0 z-50 mb-2 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md" role="menu" aria-label="Appearance">
        {options.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            className="w-full justify-start font-normal"
            role="menuitemradio"
            aria-checked={preference === value}
            onClick={(event) => {
              onChange(value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <Icon aria-hidden="true" />
            <span className="flex-1 text-left">{label}</span>
            {preference === value ? <Check aria-hidden="true" /> : null}
          </Button>
        ))}
      </div>
    </details>
  );
}

function WorkspaceSidebar({
  workspace,
  organizations,
  organizationSwitchPath,
  view,
  basePath,
  provider,
  signingOut,
  themePreference,
  idPrefix,
  onOrganizationChange,
  onNavigate,
  onSignOut,
  onThemeChange,
}: {
  workspace: WorkspaceView;
  organizations: ConfiguredOrganization[];
  organizationSwitchPath: string;
  view: View;
  basePath: string;
  provider: string;
  signingOut: boolean;
  themePreference: ThemePreference;
  idPrefix: string;
  onOrganizationChange: (slug: string, path: string) => void;
  onNavigate?: () => void;
  onSignOut: () => void;
  onThemeChange: (preference: ThemePreference) => void;
}) {
  const organizationId = `${idPrefix}-organization`;
  const profileMenuId = `${idPrefix}-profile-menu`;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const session = workspace.session;
  const authenticated = isAuthenticatedSession(session);
  return (
    <>
      <div className="min-w-0">
        <Link href={`${basePath}/model`} className="flex shrink-0 items-center gap-2.5 px-2 pb-0.5" onClick={onNavigate}>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">S</span>
          <span className="font-semibold tracking-tight">Spur</span>
          <NavigationProgress />
        </Link>
        <div className="mt-4 min-w-0 px-2">
          <label htmlFor={organizationId} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Organization</span>
          </label>
          <div className="relative">
            <select
              id={organizationId}
              value={workspace.organization.slug}
              onChange={(event) => onOrganizationChange(event.target.value, organizationSwitchPath)}
              className="border-input h-9 w-full min-w-0 appearance-none truncate rounded-md border bg-transparent py-2 pl-3 pr-9 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
            >
              {organizations.length > 0 ? organizations.map((organization) => (
                <option key={organization.slug} value={organization.slug}>{organization.name}</option>
              )) : <option value={workspace.organization.slug}>{workspace.organization.name}</option>}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          {workspace.session?.tenancy === "multi" ? (
            <Link href="/organizations" onClick={onNavigate} className="mt-2 block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Your organisations</Link>
          ) : null}
        </div>
        <div className="mt-7 min-w-0">
          <Navigation
            view={view}
            basePath={basePath}
            permissions={workspace.permissions ?? []}
            featureValues={workspace.features}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      <div className="mt-auto border-t px-2 pt-4">
        <div className="flex items-center gap-2.5">
          {authenticated ? (
            <div
              className="relative min-w-0 flex-1"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setProfileMenuOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setProfileMenuOpen(false);
                  event.currentTarget.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus();
                }
              }}
            >
              <button
                type="button"
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-controls={profileMenuId}
                className="-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-2.5 rounded-md p-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {(session.display_name || session.email).split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{session.display_name || session.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">{session.email}</span>
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", profileMenuOpen && "rotate-180")} aria-hidden="true" />
              </button>
              {profileMenuOpen ? (
                <div id={profileMenuId} role="menu" className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  <Button type="button" role="menuitem" variant="ghost" className="w-full justify-start" disabled={signingOut} onClick={onSignOut}>
                    <LogOut aria-hidden="true" /> {signingOut ? "Signing out…" : "Sign out"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{workspace.actor}</p>
                <p className="truncate text-xs text-muted-foreground">{provider} · Local mode</p>
              </div>
            </div>
          )}
          <ThemePicker preference={themePreference} onChange={onThemeChange} />
        </div>
      </div>
    </>
  );
}

type ChatTurn = {
  question: string;
  result: InvestigationResult;
};

function CompletedInvestigation({ result }: { result: InvestigationResult }) {
  const analysis = result.analysis;
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger className="rounded-md py-1 pr-1 focus-visible:ring-2 focus-visible:ring-ring">
          <TraceLine className="gap-2 py-1 text-xs">
            <TraceIcon><CheckCircle2 className="size-3.5 text-emerald-600" /></TraceIcon>
            <TraceTitle>Investigated in 4 steps</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-1.5 border-l pl-5 pt-2">
          <Trace className="gap-0.5 text-xs">
            <TraceLine className="gap-2 py-1">
              <TraceIcon><Search className="size-3.5" /></TraceIcon>
              <TraceTitle>Recalled organizational memory</TraceTitle>
              <TraceDescription>{result.recalled_memory.length} items</TraceDescription>
            </TraceLine>
            <TraceLine className="gap-2 py-1">
              <TraceIcon><FileSearch className="size-3.5" /></TraceIcon>
              <TraceTitle>Investigated {analysis.repository.name}</TraceTitle>
            </TraceLine>
            <TraceLine className="gap-2 py-1">
              <TraceIcon><ShieldCheck className="size-3.5" /></TraceIcon>
              <TraceTitle>Verified source evidence</TraceTitle>
              <TraceDescription>{analysis.evidence.length} excerpts</TraceDescription>
            </TraceLine>
            <TraceLine className="gap-2 py-1">
              <TraceIcon><Database className="size-3.5" /></TraceIcon>
              <TraceTitle>Kept the catalog unchanged</TraceTitle>
              <TraceDescription>Explicit modeling only</TraceDescription>
            </TraceLine>
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function InvestigationSources({ result }: { result: InvestigationResult }) {
  const { analysis } = result;
  if (analysis.evidence.length === 0) return null;
  return (
    <Trace className="mt-5">
      <TraceCollapsible>
        <TraceCollapsibleTrigger className="rounded-md py-1 pr-1 focus-visible:ring-2 focus-visible:ring-ring">
          <TraceLine className="gap-2 py-1 text-xs">
            <TraceIcon><GitBranch className="size-3.5" /></TraceIcon>
            <TraceTitle>
              Used {analysis.evidence.length} verified {analysis.evidence.length === 1 ? "source" : "sources"}
            </TraceTitle>
            <TraceDescription>{analysis.repository.name}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-1.5 border-l pl-5 pt-2">
          <Trace className="gap-0.5">
            {analysis.evidence.map((evidence) => (
              <EvidenceItem key={evidence.id} evidence={evidence} />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function ActiveInvestigation() {
  return (
    <Trace className="text-sm">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger className="rounded-md py-1 pr-1 focus-visible:ring-2 focus-visible:ring-ring">
          <TraceLine status="running" className="gap-2.5 py-1.5">
            <TraceIcon><LoaderCircle className="size-4 animate-spin" /></TraceIcon>
            <TraceTitle>Investigating connected knowledge</TraceTitle>
            <TraceDescription>{INVESTIGATION_STEPS.length} steps</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-1.5 border-l pl-5 pt-1">
          <Trace className="gap-0.5 text-xs">
            {INVESTIGATION_STEPS.map((step) => {
              const StepIcon = step.icon;
              return (
                <TraceLine key={step.pending} status="pending" className="gap-2 py-1">
                  <TraceIcon><StepIcon className="size-3.5" /></TraceIcon>
                  <TraceTitle>{step.pending}</TraceTitle>
                </TraceLine>
              );
            })}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function InvestigationDetails({ result }: { result: InvestigationResult }) {
  const analysis = result.analysis;
  return (
    <Trace className="mt-6 border-t pt-4">
      <TraceCollapsible>
        <TraceCollapsibleTrigger className="rounded-md py-1 pr-1 focus-visible:ring-2 focus-visible:ring-ring">
          <TraceLine className="gap-2 py-1 text-sm">
            <TraceIcon><FileSearch className="size-4" /></TraceIcon>
            <TraceTitle>Answer details</TraceTitle>
            <TraceDescription>
              {analysis.observed_behavior.length} {analysis.observed_behavior.length === 1 ? "claim" : "claims"}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="pt-5">
          <section className="border-y">
            {analysis.observed_behavior.length > 0 ? (
              analysis.observed_behavior.map((claim, index) => (
                <TruthRow
                  key={`${claim.statement}-${index}`}
                  tone="observed"
                  label="Observed in code"
                  title={index === 0 ? "Implemented behavior" : "Additional behavior"}
                  body={claim.statement}
                />
              ))
            ) : (
              <TruthRow
                tone="uncertain"
                label="Uncertain"
                title="No supported behavior found"
                body="The connected source did not provide enough attributable implementation evidence."
              />
            )}
            <TruthRow
              tone={analysis.business_rationale.status === "known" ? "known" : "uncertain"}
              label={analysis.business_rationale.status === "known" ? "Documented intent" : "Intent unknown"}
              title={analysis.business_rationale.status === "known" ? "Business rationale" : "No approved rationale"}
              body={analysis.business_rationale.statement}
            />
            <TruthRow
              tone={analysis.verified_rule.status === "verified" ? "verified" : "uncertain"}
              label={analysis.verified_rule.status === "verified" ? "Verified rule" : "Not verified"}
              title={analysis.verified_rule.status === "verified" ? "Human verification on record" : "No human verification"}
              body={analysis.verified_rule.statement}
              meta={
                analysis.verified_rule.verified_by_role && analysis.verified_rule.verified_on
                  ? `${analysis.verified_rule.verified_by_role} · ${analysis.verified_rule.verified_on}`
                  : undefined
              }
            />
          </section>

          <div className="mt-7 grid gap-7 sm:grid-cols-2">
            <section>
              <div className="flex items-center gap-2 text-foreground">
                <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-medium">Recalled memory</h3>
              </div>
              {result.recalled_memory.length > 0 ? (
                <div className="mt-2">
                  {result.recalled_memory.map((item) => (
                    <MemoryRow key={item.id} item={item} compact />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">No previous memory matched.</p>
              )}
            </section>
            <section>
              <div className="flex items-center gap-2 text-foreground">
                <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-medium">Open questions</h3>
              </div>
              {analysis.uncertainties.length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                  {analysis.uncertainties.map((uncertainty) => (
                    <li key={uncertainty} className="flex gap-2">
                      <span aria-hidden="true">·</span>
                      <span>{uncertainty}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">No unresolved questions were reported.</p>
              )}
            </section>
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function AskView({
  workspace,
  onWorkspaceChange,
  initialConversationId,
}: {
  workspace: Workspace;
  onWorkspaceChange: (workspace: Workspace) => void;
  initialConversationId: string;
}) {
  const router = useRouter();
  const basePath = `/o/${workspace.organization.slug}`;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [loadingConversation, setLoadingConversation] = useState(Boolean(initialConversationId));
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const modelConfigured = workspace.provider !== "none";

  useEffect(() => {
    let cancelled = false;
    if (!initialConversationId) {
      return () => {
        cancelled = true;
      };
    }
    fetch(`/api/conversations?id=${encodeURIComponent(initialConversationId)}`, {
      cache: "no-store",
      headers: organizationHeaders(workspace.organization.slug),
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiError(payload, "Conversation could not be loaded."));
        return payload as Conversation;
      })
      .then((conversation) => {
        if (!cancelled) {
          setTurns(conversation.turns.map((result) => ({ question: result.question, result })));
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setTurns([]);
          setError(caught instanceof Error ? caught.message : "Conversation could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialConversationId, workspace.organization.slug]);

  useEffect(() => {
    if (turns.length > 0 || loading || error) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length, loading, error]);

  async function refreshWorkspace() {
    const response = await fetch("/api/workspace", {
      cache: "no-store",
      headers: organizationHeaders(workspace.organization.slug),
    });
    const payload: unknown = await response.json();
    if (response.ok) onWorkspaceChange(payload as Workspace);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (loading || submittedQuestion.length < 5) return;
    setQuestion("");
    setPendingQuestion(submittedQuestion);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: organizationHeaders(workspace.organization.slug, true),
        body: JSON.stringify({
          question: submittedQuestion,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Investigation failed."));
      const investigation = payload as InvestigationResult;
      setTurns((current) => [...current, { question: submittedQuestion, result: investigation }]);
      if (!conversationId) {
        setConversationId(investigation.conversation_id);
        router.replace(`${basePath}/ask?conversation=${encodeURIComponent(investigation.conversation_id)}`);
      }
      setPendingQuestion("");
      await refreshWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Investigation failed.");
      setQuestion(submittedQuestion);
    } finally {
      setLoading(false);
    }
  }

  function startNewChat() {
    setQuestion("");
    setTurns([]);
    setPendingQuestion("");
    setConversationId("");
    setError(null);
    router.push(`${basePath}/ask`);
  }

  const hasConversation = turns.length > 0 || loading || Boolean(error);

  return (
    <div className="flex min-h-[calc(100svh-154px)] w-full flex-col bg-background sm:min-h-[calc(100svh-98px)] md:h-svh md:min-h-0">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background/90 px-5 backdrop-blur sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight">Ask Spur</h1>
          {turns.length > 0 ? <span className="text-xs text-muted-foreground">{turns.length} {turns.length === 1 ? "question" : "questions"}</span> : null}
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {conversationId ? (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={startNewChat} disabled={loading}>
              <Plus aria-hidden="true" />
              New chat
            </Button>
          ) : null}
          <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="truncate">{workspace.repository.name}</span>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingConversation ? (
          <div className="flex min-h-full items-center justify-center">
            <div className="text-center">
              <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-3 text-sm text-muted-foreground">Loading conversation…</p>
            </div>
          </div>
        ) : !hasConversation ? (
          <div className="flex min-h-full items-center justify-center px-5 py-16">
            <div className="max-w-xl text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">S</span>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight">What do you want to understand?</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Ask about behavior, business rules, controls, systems, integrations, or relationships in the connected sources.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
            {turns.map((turn) => (
              <div key={turn.result.id} className="mb-12 space-y-7 last:mb-0">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-6 sm:max-w-[72%]">
                    {turn.question}
                  </div>
                </div>

                <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 sm:gap-4">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">S</span>
                  <div className="min-w-0 pt-0.5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">Spur</span>
                      <Badge variant={turn.result.analysis.status === "supported" ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px] font-normal">
                        {turn.result.analysis.status === "supported" ? "Evidence-backed" : "Incomplete"}
                      </Badge>
                    </div>
                    <CompletedInvestigation result={turn.result} />
                    <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-foreground">
                      {turn.result.answer}
                    </p>
                    <InvestigationSources result={turn.result} />
                    <InvestigationDetails result={turn.result} />
                  </div>
                </article>
              </div>
            ))}

            {loading ? (
              <div className="mb-12 space-y-7">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-6 sm:max-w-[72%]">
                    {pendingQuestion}
                  </div>
                </div>
                <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 sm:gap-4">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">S</span>
                  <div className="min-w-0 pt-1">
                    <p className="mb-3 text-sm font-semibold">Spur</p>
                    <ActiveInvestigation />
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <Alert variant="destructive" className="ml-0 mt-6 sm:ml-12">
                <AlertCircle aria-hidden="true" />
                <AlertTitle>Investigation stopped</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 bg-gradient-to-t from-background via-background to-background/0 px-4 pb-4 pt-3 sm:px-6 sm:pb-6">
        <form onSubmit={submit} className="mx-auto w-full max-w-4xl">
          <div className="rounded-3xl border bg-card p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-3 focus-within:ring-ring/15">
            <Textarea
              id="question"
              aria-label="Message Spur"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              disabled={loading || !modelConfigured}
              maxLength={500}
              rows={2}
              placeholder="Ask Spur"
              className="max-h-40 min-h-14 resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <p className="truncate text-[11px] text-muted-foreground">
                {modelConfigured
                  ? "Answers are checked against connected sources."
                  : "Configure Anthropic or OpenAI, or use Spur through MCP."}
              </p>
              <Button
                type="submit"
                size="icon"
                className="size-8 shrink-0 rounded-full"
                disabled={!modelConfigured || loading || question.trim().length < 5}
                aria-label={loading ? "Investigating" : "Send message"}
              >
                {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Questions are read-only. Add knowledge through explicit modeling or catalog edits.
          </p>
        </form>
      </div>
    </div>
  );
}

function SourceIcon({ source }: { source: Source }) {
  if (source.kind === "repository") return <GitBranch aria-hidden="true" />;
  if (source.kind === "mcp_server") return <Server aria-hidden="true" />;
  return <BookOpen aria-hidden="true" />;
}

function SourcesView({ workspace, onRefresh }: { workspace: Workspace; onRefresh: () => Promise<void> }) {
  const canManageSources = workspace.permissions?.includes("sources.manage") === true;
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    kind: "repository" as "repository" | "mcp_server" | "document",
    name: "",
    locator: "",
    authentication: "none" as "none" | "bearer_env",
    credential_env: "",
  });

  const mcpConfig = workspace.mcp ? JSON.stringify({
    mcpServers: {
      [workspace.mcp.server_name]: {
        command: workspace.mcp.command,
        args: workspace.mcp.args,
        cwd: workspace.mcp.cwd,
        env: {
          DATABASE_URL: "<required: PostgreSQL URL for this Spur tenant>",
          SPUR_ORGANIZATION_SLUG: workspace.organization.slug,
          SPUR_REPOSITORY_ROOT: workspace.mcp.repository_root,
        },
      },
    },
  }, null, 2) : "";

  async function register(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: organizationHeaders(workspace.organization.slug, true),
        body: JSON.stringify({
          ...form,
          credential_env: form.authentication === "bearer_env" ? form.credential_env : undefined,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Source could not be registered."));
      setMessage("Source registered. Credentials remain in the named environment variable.");
      setForm({ ...form, name: "", locator: "", credential_env: "" });
      await onRefresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Source could not be registered.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(source: Source) {
    const response = await fetch("/api/sources", {
      method: "PATCH",
      headers: organizationHeaders(workspace.organization.slug, true),
      body: JSON.stringify({ id: source.id, enabled: !source.enabled }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      setMessage(apiError(payload, "Source could not be updated."));
      return;
    }
    await onRefresh();
  }

  async function copyMcpConfig() {
    await navigator.clipboard.writeText(mcpConfig);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-9 xl:px-10 2xl:px-12">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManageSources
              ? "Manage where Spur may investigate. Credentials are never stored in source URLs."
              : "View where Spur may investigate and connect an AI agent through MCP."}
          </p>
        </div>
        {canManageSources ? (
          <Button type="button" onClick={() => setShowForm((current) => !current)}>
            <Plus aria-hidden="true" />
            Register source
          </Button>
        ) : null}
      </header>

      {canManageSources && showForm ? (
        <form onSubmit={register} className="grid gap-4 border-b bg-muted/25 py-6 sm:grid-cols-2 lg:grid-cols-[160px_1fr_1.25fr_180px_auto] lg:items-end">
          <div>
            <label htmlFor="source-kind" className="mb-1.5 block text-sm font-medium">Type</label>
            <select
              id="source-kind"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as typeof form.kind })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
            >
              <option value="repository">Git repository</option>
              <option value="mcp_server">MCP server</option>
              <option value="document">Document index</option>
            </select>
          </div>
          <div>
            <label htmlFor="source-name" className="mb-1.5 block text-sm font-medium">Name</label>
            <Input id="source-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Customer portal" />
          </div>
          <div>
            <label htmlFor="source-locator" className="mb-1.5 block text-sm font-medium">
              {form.kind === "repository" ? "Repository URL" : "HTTPS endpoint"}
            </label>
            <Input
              id="source-locator"
              required
              type="url"
              value={form.locator}
              onChange={(event) => setForm({ ...form, locator: event.target.value })}
              placeholder={form.kind === "repository" ? "https://github.com/company/app.git" : "https://mcp.example.com/mcp"}
            />
          </div>
          <div>
            <label htmlFor="source-auth" className="mb-1.5 block text-sm font-medium">Authentication</label>
            <select
              id="source-auth"
              value={form.authentication}
              onChange={(event) => setForm({ ...form, authentication: event.target.value as typeof form.authentication })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
            >
              <option value="none">Public / none</option>
              <option value="bearer_env">Bearer token via env</option>
            </select>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Register
          </Button>
          {form.authentication === "bearer_env" ? (
            <div className="sm:col-span-2 lg:col-span-5">
              <label htmlFor="credential-env" className="mb-1.5 block text-sm font-medium">Credential environment variable</label>
              <Input
                id="credential-env"
                required
                value={form.credential_env}
                onChange={(event) => setForm({ ...form, credential_env: event.target.value.toUpperCase() })}
                placeholder={form.kind === "repository" ? "GITHUB_TOKEN" : "SOURCE_MCP_TOKEN"}
                className="max-w-sm font-mono"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">Only the variable name is stored. The secret stays in the process environment.</p>
            </div>
          ) : null}
          {message ? <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-5">{message}</p> : null}
        </form>
      ) : null}

      <section>
        {workspace.sources.map((source) => (
          <article key={source.id} className="grid gap-4 border-b py-5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-center">
            <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4">
              <SourceIcon source={source} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">{source.name}</h2>
                <Badge variant={source.status === "connected" ? "secondary" : "outline"} className="font-normal">
                  {source.status}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{source.locator}</p>
              {typeof source.metadata.connection_note === "string" ? (
                <p className="mt-1 text-xs text-amber-700">{source.metadata.connection_note}</p>
              ) : source.last_synced_at ? (
                <p className="mt-1 text-xs text-muted-foreground">Last read {new Date(source.last_synced_at).toLocaleString()}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {source.kind === "repository" ? (
                <Badge variant="outline" className="gap-1.5 font-normal">
                  <Check aria-hidden="true" /> Read only
                </Badge>
              ) : canManageSources ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void toggle(source)}>
                  {source.enabled ? "Disable" : "Enable"}
                  <ChevronRight aria-hidden="true" />
                </Button>
              ) : null}
              {canManageSources ? (
                <RemoveSourceButton source={source} organization={workspace.organization.slug} onRemoved={onRefresh} />
              ) : null}
            </div>
          </article>
        ))}
        {workspace.sources.length === 0 ? (
          <p className="border-b py-8 text-sm text-muted-foreground">No sources connected. Existing knowledge is still available in the catalog and Ask Spur.</p>
        ) : null}
      </section>

      {workspace.mcp?.ready ? <section className="mt-10 border-t pt-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <TerminalSquare className="size-4" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">Spur MCP</h2>
                <Badge variant="secondary" className="font-normal">ready</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Connect Claude Code or another MCP client over stdio. The agent can inspect connected repositories, model and query knowledge, and—with explicit approval—edit, promote, or archive catalog objects.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyMcpConfig()}>
            {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
            {copied ? "Copied" : "Copy config"}
          </Button>
        </div>
        <pre className="mt-4 max-h-72 overflow-auto rounded-md border bg-muted/35 p-4 text-xs leading-5 text-muted-foreground">
          <code>{mcpConfig}</code>
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          MCP modeling uses the client&apos;s own model access. Configure a Spur synthesis provider only if you also want to use Ask Spur.
        </p>
      </section> : null}
    </div>
  );
}

function GuideView({ workspace }: { workspace: Workspace }) {
  const modelConfigured = workspace.provider !== "none";
  const basePath = `/o/${workspace.organization.slug}`;
  const steps = [
    {
      title: "Check the source",
      body: "Open Sources and confirm which Git repository is active for the organization. Spur reads the version of the repository committed to Git.",
      href: `${basePath}/sources`,
      link: "Open Sources",
    },
    {
      title: "Connect your AI agent",
      body: "Copy the MCP configuration from Sources to Claude Code or another MCP client. MCP (Model Context Protocol) gives the agent tools to read from and write to Spur. The agent uses its own model and does not need an AI key in Spur.",
      href: `${basePath}/sources`,
      link: "View MCP configuration",
    },
    {
      title: "Model what exists in the code",
      body: "Ask the agent to examine the repository and propose systems, capabilities, processes, controls, rules, information, and entities. It can add attributes, information classifications, storage locations, and relationships. Spur checks every cited code excerpt against the committed version before saving anything as a candidate.",
      href: `${basePath}/model/catalog`,
      link: "View catalog",
    },
    {
      title: "Review and use the model",
      body: "Open object details and source excerpts in the catalog. Correct errors, accept reviewed candidates, and archive anything that should not be used. Then ask questions in Ask Spur or through MCP.",
      href: `${basePath}/ask`,
      link: "Open Ask Spur",
    },
  ];

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-9 xl:px-10 2xl:px-12">
      <header className="border-b pb-8">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Guide
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">How to use Spur</h1>
        <p className="mt-4 max-w-4xl text-base leading-7 text-muted-foreground">
          Spur collects knowledge about the business and its systems that can be traced to a source.
          An AI agent can model what it finds in the code. You can then review the model and ask how
          capabilities, processes, rules, information, and systems fit together.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild><Link href={`${basePath}/sources`}>Get started with Sources</Link></Button>
          <Button asChild variant="outline"><Link href={`${basePath}/ask`}>Ask a question</Link></Button>
        </div>
      </header>

      <section className="border-b py-8 sm:py-10" aria-labelledby="guide-start">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="guide-start" className="text-xl font-semibold tracking-tight">Get started</h2>
          <p className="text-sm text-muted-foreground">Current repository: {workspace.repository.name}</p>
        </div>
        <ol className="divide-y border-y">
          {steps.map((step, index) => (
            <li key={step.title} className="grid gap-2 py-5 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:items-start sm:gap-5">
              <span className="text-sm font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <h3 className="text-base font-medium">{step.title}</h3>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{step.body}</p>
              </div>
              <Link href={step.href} className="text-sm font-medium text-primary underline-offset-4 hover:underline sm:pt-0.5">
                {step.link}
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Example prompt for Claude Code: <span className="font-medium text-foreground">“Investigate how campaign budgets are changed. Model the relevant processes, controls, entities, and relationships in Spur, using code excerpts as evidence.”</span>
        </p>
      </section>

      <GuideModelReference basePath={basePath} />

      <section className="border-b py-8 sm:py-10" aria-labelledby="guide-ask">
        <h2 id="guide-ask" className="text-xl font-semibold tracking-tight">When you ask a question</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          Ask in Ask Spur or through MCP. Example: “Which controls restrict large budget changes?”
        </p>
        <div className="mt-6 grid gap-x-10 gap-y-5 border-t pt-5 md:grid-cols-3">
          <div>
            <h3 className="text-sm font-medium">1. Find modeled knowledge</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Spur searches every object type, including entity attributes, classifications, and storage locations, and retrieves relevant relationships.</p>
          </div>
          <div>
            <h3 className="text-sm font-medium">2. Compare with the code</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">When live code search is enabled or approved, Spur can search connected repositories and check code excerpts. Otherwise, answers use stored knowledge.</p>
          </div>
          <div>
            <h3 className="text-sm font-medium">3. Answer with evidence</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">The answer can use both memory objects and code. Ask Spur saves the conversation but does not create new catalog objects.</p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          {modelConfigured
            ? "Ask Spur uses the AI provider configured for the web application. The MCP client can use its own model."
            : "Ask Spur on the web requires a configured OpenAI or Anthropic provider. The MCP client can still investigate and model using its own model."}
        </p>
      </section>

      <section className="border-b py-8 sm:py-10" aria-labelledby="guide-areas">
        <h2 id="guide-areas" className="text-xl font-semibold tracking-tight">Find the right view</h2>
        <div className="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "Sources", body: "View the active repository, source status, and MCP configuration.", href: `${basePath}/sources` },
            { title: "Model", body: "Explore relationships, decisions, and knowledge gaps in the catalog and model.", href: `${basePath}/model` },
            { title: "ISMS controls", body: "Manage approved security controls, owners, applicability, and versions separately from the code.", href: `${basePath}/isms/controls` },
            { title: "Ask Spur", body: "Ask follow-up questions across the model and repository.", href: `${basePath}/ask` },
          ].map((area) => (
            <div key={area.title} className="border-t pt-4">
              <h3 className="text-sm font-medium"><Link href={area.href} className="underline-offset-4 hover:underline">{area.title}</Link></h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{area.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-8 sm:py-10" aria-labelledby="guide-trust">
        <h2 id="guide-trust" className="text-xl font-semibold tracking-tight">Interpret the results correctly</h2>
        <div className="mt-5 grid gap-x-10 gap-y-5 md:grid-cols-2">
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">Candidate</span> is a proposal that needs review.
            <span className="ml-1 font-medium text-foreground">Accepted</span> is approved knowledge.
            <span className="ml-1 font-medium text-foreground">Disputed</span> and <span className="font-medium text-foreground">stale</span> identify challenged or outdated knowledge.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Code shows what the implementation does in a specific version. Business rationale requires separate evidence or a human decision. Review both the status and source excerpts before accepting an object.
          </p>
        </div>
        <p className="mt-5 border-t pt-5 text-sm leading-6 text-muted-foreground">
          Registered external MCP servers and document sources appear in Sources, but Spur does not search them automatically yet. Ask Spur uses the active repository source.
        </p>
      </section>
    </div>
  );
}

export function SpurWorkspace({
  organizationSlug,
  initialModelSelection = "",
  initialModelRelationship = "",
  initialModelMap = "",
  initialModelFocus = "",
  initialModelEntityId = "",
  initialCatalogQuery = "",
  initialCatalogKind = "all",
  initialProductDocumentId = "",
  initialProductDocumentType = "all",
  initialProductDocumentQuery = "",
  initialConversationId = "",
  initialIsmsSelection = "",
  initialWikiPageId = "",
}: {
  organizationSlug: string;
  initialModelSelection?: string;
  initialModelRelationship?: string;
  initialModelMap?: string;
  initialModelFocus?: string;
  initialModelEntityId?: string;
  initialCatalogQuery?: string;
  initialCatalogKind?: string;
  initialProductDocumentId?: string;
  initialProductDocumentType?: string;
  initialProductDocumentQuery?: string;
  initialConversationId?: string;
  initialIsmsSelection?: string;
  initialWikiPageId?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const segments = pathname.split("/");
  const organizationRoute = segments[1] === "o";
  const segment = organizationRoute ? segments[3] : segments[1];
  const subSegment = organizationRoute ? segments[4] : segments[2];
  const detailSegment = organizationRoute ? segments[5] : segments[3];
  const view: View = segment === "model"
    ? subSegment === "catalog"
      ? detailSegment ? "entity" : "catalog"
      : subSegment === "health"
        ? "health"
        : subSegment === "gaps"
          ? "gaps"
          : "model"
    : segment === "documents"
      ? subSegment ? "document" : "documents"
    : segment === "sources" || segment === "guide" || segment === "isms" || segment === "wiki" || segment === "admin"
      ? segment
      : "ask";
  const [workspace, setWorkspace] = useWorkspaceState(organizationSlug);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [navigating, startNavigation] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [organizations, setOrganizations] = useState<ConfiguredOrganization[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");

  const basePath = `/o/${organizationSlug}`;
  const organizationSwitchPath = view === "catalog" || view === "entity"
    ? "model/catalog"
    : view === "documents" || view === "document"
      ? "documents"
    : view === "health" || view === "gaps"
      ? `model/${view}`
      : view === "isms"
        ? "isms/controls"
        : view === "guide"
          ? "model"
      : view;

  async function loadWorkspace() {
    setLoadingWorkspace(true);
    try {
      const response = await fetch("/api/workspace", {
        cache: "no-store",
        headers: organizationHeaders(organizationSlug),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setWorkspace(null);
        if (response.status === 401) setAuthRequired(true);
        throw new Error(apiError(payload, "Workspace could not be loaded."));
      }
      setWorkspace(payload as WorkspaceView);
      setError(null);
      setAuthRequired(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace could not be loaded.");
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function signOut() {
    if (signingOut || !isAuthenticatedSession(workspace?.session)) return;
    setSigningOut(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: organizationHeaders(organizationSlug),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(payload, "Sign out failed."));
      setWorkspace(null);
      setAuthRequired(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed.");
    } finally {
      setSigningOut(false);
    }
  }

  function changeTheme(preference: ThemePreference) {
    const nextDarkMode = preference === "dark" || (
      preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
    setThemePreference(preference);
    document.documentElement.classList.toggle("dark", nextDarkMode);
    document.documentElement.style.colorScheme = nextDarkMode ? "dark" : "light";
    try {
      window.localStorage.setItem("spur-theme", preference);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/organizations", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { organizations?: ConfiguredOrganization[] }) => {
        if (!cancelled) setOrganizations(payload.organizations ?? []);
      })
      .catch(() => undefined);
    fetch("/api/workspace", {
      cache: "no-store",
      headers: organizationHeaders(organizationSlug),
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) {
          if ((response.status === 401 || response.status === 403) && !cancelled) setWorkspace(null);
          if (response.status === 401 && !cancelled) setAuthRequired(true);
          throw new Error(apiError(payload, "Workspace could not be loaded."));
        }
        if (!cancelled) {
          setWorkspace(payload as WorkspaceView);
          setError(null);
          setAuthRequired(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Workspace could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspace(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationSlug, setWorkspace]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      let preference: ThemePreference = "system";
      try {
        const saved = window.localStorage.getItem("spur-theme");
        if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
      } catch {
        // Keep the system default when browser storage is unavailable.
      }
      setThemePreference(preference);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (themePreference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      document.documentElement.classList.toggle("dark", event.matches);
      document.documentElement.style.colorScheme = event.matches ? "dark" : "light";
    };
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, [themePreference]);

  useEffect(() => {
    if (!workspace || view !== "entity" || !initialModelEntityId) return;
    const item = workspace.memory.find((candidate) => candidate.id === initialModelEntityId);
    if (!item || !isProductDocument(item)) return;
    startNavigation(() => router.replace(productDocumentPath(organizationSlug, item.id)));
  }, [initialModelEntityId, organizationSlug, router, startNavigation, view, workspace]);

  if (authRequired) {
    const organization = organizations.find((item) => item.slug === organizationSlug);
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/20 p-6">
        <section className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LockKeyhole className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Open {organization?.name ?? organizationSlug}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in with your email. Your first sign-in creates an access request for an administrator to approve.
          </p>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <Button asChild className="mt-5 w-full">
            <a href={signInPath(organizationSlug, `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`)}>
              <LockKeyhole aria-hidden="true" /> Sign in
            </a>
          </Button>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Spur could not start</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!workspace) {
    return <WorkspaceLoading />;
  }

  const productDocumentIds = new Set(
    workspace.memory.filter(isProductDocument).map((item) => item.id),
  );
  const modelWorkspace: WorkspaceView = {
    ...workspace,
    memory: workspace.memory.filter((item) => !productDocumentIds.has(item.id)),
    relationships: workspace.relationships.filter((relationship) =>
      !productDocumentIds.has(relationship.from_id) && !productDocumentIds.has(relationship.to_id)),
  };
  const provider = workspace.provider === "anthropic" ? "Claude" : workspace.provider === "openai" ? "OpenAI" : "MCP only";

  if (view === "wiki") {
    return <>
      {loadingWorkspace ? <TopLoadingBar label="Refreshing organizational memory" /> : null}
      <WikiView key={initialWikiPageId || "wiki-home"} organizationId={workspace.organization.slug} initialPageId={initialWikiPageId} canExport={(workspace.permissions ?? []).includes("wiki.export")} />
    </>;
  }

  return (
    <main className="min-h-svh bg-background md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      {loadingWorkspace || navigating ? <TopLoadingBar label="Loading workspace" /> : null}
      <aside className="sticky top-0 hidden h-svh min-w-0 flex-col border-r bg-card px-3 py-4 md:flex">
        <WorkspaceSidebar
          workspace={workspace}
          organizations={organizations}
          organizationSwitchPath={organizationSwitchPath}
          view={view}
          basePath={basePath}
          provider={provider}
          signingOut={signingOut}
          themePreference={themePreference}
          idPrefix="desktop"
          onOrganizationChange={(slug, path) => startNavigation(() => router.push(`/o/${slug}/${path}`))}
          onSignOut={() => void signOut()}
          onThemeChange={changeTheme}
        />
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-background/90 px-4 backdrop-blur md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Open navigation">
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              closeLabel="Close navigation"
              className="w-[min(88vw,20rem)] gap-0 bg-card p-4 sm:max-w-xs"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Switch organization, navigate Spur, or change appearance.</SheetDescription>
              </SheetHeader>
              <WorkspaceSidebar
                workspace={workspace}
                organizations={organizations}
                organizationSwitchPath={organizationSwitchPath}
                view={view}
                basePath={basePath}
                provider={provider}
                signingOut={signingOut}
                themePreference={themePreference}
                idPrefix="mobile"
                onOrganizationChange={(slug, path) => {
                  setMobileNavOpen(false);
                  startNavigation(() => router.push(`/o/${slug}/${path}`));
                }}
                onNavigate={() => setMobileNavOpen(false)}
                onSignOut={() => void signOut()}
                onThemeChange={changeTheme}
              />
            </SheetContent>
          </Sheet>
          <Link
            href={`${basePath}/model`}
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2"
            aria-label="Spur home"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">S</span>
            <span className="font-semibold tracking-tight">Spur</span>
            <NavigationProgress />
          </Link>
        </header>
        {view === "ask" ? (
          <AskView
            key={initialConversationId || "new"}
            workspace={workspace}
            onWorkspaceChange={setWorkspace}
            initialConversationId={initialConversationId}
          />
        ) : null}
        {view === "model" ? (
          <ModelOverview
            workspace={modelWorkspace}
            initialSelected={initialModelSelection}
            initialRelationship={initialModelRelationship}
            initialMap={initialModelMap}
            initialFocus={initialModelFocus}
          />
        ) : null}
        {view === "catalog" ? <ModelCatalog workspace={modelWorkspace} initialQuery={initialCatalogQuery} initialKind={initialCatalogKind} onRefresh={loadWorkspace} /> : null}
        {view === "entity" ? <ModelEntityDetail key={initialModelEntityId} workspace={modelWorkspace} entityId={initialModelEntityId} onRefresh={loadWorkspace} /> : null}
        {view === "health" ? <ModelHealth workspace={modelWorkspace} /> : null}
        {view === "gaps" ? <KnowledgeGapsView workspace={workspace} /> : null}
        {view === "documents" || view === "document" ? (
          <ProductDocuments
            key={initialProductDocumentId || `${initialProductDocumentType}:${initialProductDocumentQuery}`}
            workspace={workspace}
            initialDocumentId={initialProductDocumentId}
            initialType={initialProductDocumentType}
            initialQuery={initialProductDocumentQuery}
            onRefresh={loadWorkspace}
          />
        ) : null}
        {view === "isms" ? <IsmsCatalog workspace={workspace} initialSelected={initialIsmsSelection} /> : null}
        {view === "sources" ? <SourcesView workspace={workspace} onRefresh={loadWorkspace} /> : null}
        {view === "admin" ? <AdminAccess organizationId={workspace.organization.slug} /> : null}
        {view === "guide" ? <GuideView workspace={workspace} /> : null}
      </section>
    </main>
  );
}
