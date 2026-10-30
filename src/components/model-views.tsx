"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  GitCommitHorizontal,
  LoaderCircle,
  Network,
  Plus,
  Search,
  ShieldCheck,
  TableProperties,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ModelGraph } from "@/components/model-graph";
import { ModelMapExplorer } from "@/components/model-map-explorer";
import { ModelMapThemeSelect } from "@/components/model-map-theme-select";
import { entityDefinitionSchema } from "@/core/memory-types";
import type {
  MemoryKind,
  MemoryObject,
  Workspace,
} from "@/core/memory-types";
import { cn } from "@/lib/utils";
import { MAP_OVERVIEW_LIMIT, modelData, projectModelMap } from "@/lib/model-map";
import { navigateModelMap, readMapTrail, type MapMode } from "@/lib/model-map-navigation";
import { isMapThemeId, MAP_THEME_STORAGE_KEY, type MapThemeId } from "@/lib/model-map-theme";
import type { MapPresentation } from "@/lib/model-network";

export const KIND_LABELS: Record<MemoryKind, string> = {
  application: "Application",
  system: "System",
  integration: "Integration",
  information: "Information",
  entity: "Entity",
  capability: "Capability",
  process: "Process",
  control: "Technical control",
  decision: "Decision",
  rule: "Rule",
  observation: "Observation",
};

export const MODEL_KINDS: MemoryKind[] = [
  "system",
  "capability",
  "process",
  "integration",
  "information",
  "entity",
  "rule",
  "control",
  "observation",
];

const ARCHITECTURE_KINDS = new Set<MemoryKind>([
  "application",
  "system",
  "capability",
  "process",
  "integration",
]);

const MODEL_KIND_DESCRIPTIONS: Partial<Record<MemoryKind, string>> = {
  application: "An application represented in organizational memory.",
  system: "Software or infrastructure with a distinct responsibility.",
  capability: "Business or technical ability supported by the implementation.",
  process: "A sequence of actions or state changes.",
  integration: "A connection or exchange between systems.",
  information: "Data created, consumed, or governed by the system.",
  entity: "A business or data object with defined attributes, classification, and storage locations.",
  rule: "A condition or policy expressed by the implementation.",
  control: "A safeguard observed in the implementation. ISMS controls are governed separately.",
  observation: "A notable implementation finding, limitation, or risk.",
  decision: "A recorded choice, its rationale, and supporting evidence.",
};

const MODEL_KIND_TAB_LABELS: Partial<Record<MemoryKind, string>> = {
  application: "Applications",
  system: "Systems",
  capability: "Capabilities",
  process: "Processes",
  integration: "Integrations",
  information: "Information",
  entity: "Entities",
  rule: "Rules",
  control: "Technical controls",
  observation: "Observations",
  decision: "Decisions",
};

const CATALOG_KINDS: MemoryKind[] = ["application", ...MODEL_KINDS, "decision"];

type ModelView = "overview" | "catalog" | "health" | "gaps";

function ModelTabs({ active, basePath, knowledgeGaps }: { active: ModelView; basePath: string; knowledgeGaps: boolean }) {
  return (
    <nav
      aria-label="Model sections"
      className="-mx-5 flex snap-x gap-5 overflow-x-auto overscroll-x-contain border-b px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:gap-6 sm:px-0"
    >
      {[
        { id: "overview" as const, label: "Overview", href: `${basePath}/model`, icon: Network },
        { id: "catalog" as const, label: "Catalog", href: `${basePath}/model/catalog`, icon: TableProperties },
        { id: "health" as const, label: "Model health", href: `${basePath}/model/health`, icon: ShieldCheck },
        { id: "gaps" as const, label: "Knowledge gaps", href: `${basePath}/model/gaps`, icon: Search },
      ].filter((item) => item.id !== "gaps" || knowledgeGaps).map(({ id, label, href, icon: Icon }) => (
        <Link
          key={id}
          href={href}
          aria-current={active === id ? "page" : undefined}
          className={cn(
            "relative flex h-11 shrink-0 snap-start items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform",
            active === id && "text-foreground after:scale-x-100",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function StateBadge({ item }: { item: MemoryObject }) {
  return (
    <Badge
      variant={item.state === "accepted" ? "success" : item.state === "candidate" ? "warning" : "outline"}
      className="font-normal capitalize"
    >
      {item.state}
    </Badge>
  );
}

const coverageChartConfig = {
  objects: {
    label: "Objects",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

function ModelCoverageChart({ objects }: { objects: MemoryObject[] }) {
  const data = MODEL_KINDS.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    objects: objects.filter((item) => item.kind === kind).length,
  })).filter((item) => item.objects > 0);

  return (
    <div>
      <ChartContainer
        config={coverageChartConfig}
        className="h-[min(62svh,620px)] min-h-[420px] w-full"
      >
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 44, top: 12, bottom: 12 }}
        >
          <CartesianGrid horizontal={false} strokeDasharray="3 3" />
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            dataKey="label"
            type="category"
            tickLine={false}
            axisLine={false}
            width={112}
            tickMargin={12}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.55 }}
            content={<ChartTooltipContent hideLabel indicator="line" />}
          />
          <Bar dataKey="objects" fill="var(--color-objects)" radius={[0, 7, 7, 0]} maxBarSize={48}>
            <LabelList dataKey="objects" position="right" className="fill-foreground" fontSize={12} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function ModelHeader({ workspace, active }: { workspace: Workspace; active: ModelView }) {
  const basePath = `/o/${workspace.organization.slug}`;
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-5 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            {workspace.repository.name}
            <span aria-hidden="true">·</span>
            <GitCommitHorizontal className="size-3.5" aria-hidden="true" />
            <code>{workspace.repository.commit_sha.slice(0, 8)}</code>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Modeled knowledge</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Explore modeled knowledge, human decisions, and their evidence.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`${basePath}/sources`}>Manage source</Link>
        </Button>
      </header>
      <ModelTabs active={active} basePath={basePath} knowledgeGaps={workspace.features?.knowledge_gaps !== false} />
    </>
  );
}

export function ModelOverview({
  workspace,
}: {
  workspace: Workspace;
  initialSelected?: string;
  initialRelationship?: string;
  initialMap?: string;
  initialFocus?: string;
}) {
  const searchParams = useSearchParams();
  const basePath = `/o/${workspace.organization.slug}`;
  const [mapTheme, setMapTheme] = useState<MapThemeId>("auto");
  const { objects, relationships } = useMemo(() => modelData(workspace), [workspace]);
  const mapMode: MapMode = searchParams.get("map") === "architecture" ? "architecture" : "entities";
  const presentation: MapPresentation = searchParams.get("style") === "cards" ? "cards" : "network";
  const architectureObjects = useMemo(
    () => objects.filter((item) => ARCHITECTURE_KINDS.has(item.kind)),
    [objects],
  );
  const entityObjects = useMemo(
    () => objects.filter((item) => item.kind === "entity"),
    [objects],
  );
  const mapObjects = mapMode === "entities" ? entityObjects : architectureObjects;
  const graphRelationships = useMemo(() => {
    const graphIds = new Set(mapObjects.map((item) => item.id));
    return relationships.filter(
      (relationship) =>
        relationship.from_id !== relationship.to_id &&
        graphIds.has(relationship.from_id) &&
        graphIds.has(relationship.to_id),
    );
  }, [mapObjects, relationships]);
  const graphObjects = useMemo(() => {
    const connectedIds = new Set(
      graphRelationships.flatMap((relationship) => [relationship.from_id, relationship.to_id]),
    );
    return mapObjects.filter((item) => connectedIds.has(item.id));
  }, [mapObjects, graphRelationships]);
  const selectedId = searchParams.get("selected") ?? "";
  const selectedRelationshipId = searchParams.get("relationship") ?? "";
  const focusId = searchParams.get("focus") ?? "";
  const requestedPage = Number(searchParams.get("page"));
  const projection = useMemo(() => projectModelMap(graphObjects, graphRelationships, {
    focusId,
    page: requestedPage,
  }), [graphObjects, graphRelationships, focusId, requestedPage]);
  const { objects: visibleObjects, relationships: visibleRelationships, focus: focused } = projection;
  const trail = focused ? readMapTrail(searchParams).flatMap((step) => {
    const item = graphObjects.find((object) => object.id === step.id && object.id !== focused.id);
    return item ? [item] : [];
  }) : [];

  const selected = graphObjects.find((item) => item.id === selectedId);
  const selectedRelationship = graphRelationships.find(
    (relationship) => relationship.id === selectedRelationshipId,
  );
  const selectedRelationshipFrom = selectedRelationship
    ? graphObjects.find((item) => item.id === selectedRelationship.from_id)
    : undefined;
  const selectedRelationshipTo = selectedRelationship
    ? graphObjects.find((item) => item.id === selectedRelationship.to_id)
    : undefined;
  const selectedRelationships = selected
    ? graphRelationships.filter(
      (relationship) => relationship.from_id === selected.id || relationship.to_id === selected.id,
    )
    : [];
  const evidenceCount = new Set(objects.flatMap((item) => item.evidence_ids)).size;
  const averageConfidence = objects.length > 0
    ? Math.round((objects.reduce((sum, item) => sum + item.confidence, 0) / objects.length) * 100)
    : 0;

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(MAP_THEME_STORAGE_KEY);
    if (!isMapThemeId(storedTheme)) return;
    const frame = window.requestAnimationFrame(() => setMapTheme(storedTheme));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function changeMapTheme(theme: MapThemeId) {
    setMapTheme(theme);
    window.localStorage.setItem(MAP_THEME_STORAGE_KEY, theme);
  }

  function changeMapMode(mode: MapMode) {
    navigateModelMap({ type: "mode", mode });
  }

  function changePresentation(value: MapPresentation) {
    navigateModelMap({ type: "presentation", presentation: value });
  }

  function selectNode(id: string) {
    navigateModelMap({ type: "selection", key: "selected", id });
  }

  function focusOnNode(id: string) {
    navigateModelMap({ type: "focus", id });
  }

  function selectRelationship(id: string) {
    navigateModelMap({ type: "selection", key: "relationship", id });
  }

  function clearSelection() {
    navigateModelMap({ type: "clear-selection" });
  }

  const mapSummary = focused
    ? `${focused.title} · neighbours ${projection.neighborStart}–${projection.neighborEnd} of ${projection.availableCount - 1} · direct links only`
    : `${visibleObjects.length} of ${graphObjects.length} ${mapMode === "entities" ? "entities" : "architecture objects"} · most connected first`;

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <ModelHeader workspace={workspace} active="overview" />

      <section className="border-b py-5" aria-label="Model summary">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Model at a glance</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {averageConfidence}% average confidence across the current source model.
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="-mr-3 h-7 text-xs">
              <Link href={`${basePath}/model/catalog`}>Review catalog <ArrowRight className="size-3.5" /></Link>
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-5">
            {[
              [String(objects.length), "Modeled objects"],
              [String(relationships.length), "Mapped links"],
              [String(evidenceCount), "Code excerpts"],
              [String(objects.filter((item) => item.state === "candidate").length), "Need review"],
            ].map(([value, label], index) => (
              <div
                key={label}
                className={cn("min-w-32", index > 0 && "sm:border-l sm:pl-10")}
              >
                <p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {objects.length === 0 ? (
        <section className="py-24 text-center">
          <Boxes className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-medium">No source model yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Ask Claude Code to run Spur&apos;s source-analysis workflow. Verified candidates will appear here.
          </p>
        </section>
      ) : (
        <section className="min-h-[620px]">
          <div className="min-w-0 py-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{mapMode === "entities" ? "Entity map" : "Architecture map"}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {presentation === "network"
                    ? "Click a node to explore its connections. Details opens the inspector; Back retraces your steps."
                    : focused
                      ? "Explore a neighbour to follow its connections. Use Back or the trail to retrace your steps."
                      : `Start with up to ${MAP_OVERVIEW_LIMIT} connected ${mapMode === "entities" ? "entities" : "objects"}. Search or explore a node to see its neighbours.`}
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <ModelMapThemeSelect value={mapTheme} onChange={changeMapTheme} />
                <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1" role="group" aria-label="Map view">
                  {(["entities", "architecture"] as const).map((value) => (
                    <Button key={value} type="button" size="sm" variant="ghost" aria-pressed={mapMode === value} onClick={() => changeMapMode(value)}
                      className={`h-8 gap-1.5 border px-3 text-xs ${mapMode === value ? "border-primary/60 bg-primary/15 font-semibold text-foreground shadow-xs hover:bg-primary/20 hover:text-foreground" : "border-transparent text-muted-foreground"}`}>
                      {value === "entities" ? "Entities" : "Architecture"}
                      <Check className={mapMode === value ? "" : "invisible"} aria-hidden="true" />
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {graphObjects.length > 0 ? (
              <ModelGraph
                key={mapMode}
                dense={visibleObjects.length > 24}
                presentation={presentation}
                onPresentationChange={changePresentation}
                objects={visibleObjects}
                relationships={visibleRelationships}
                focusableObjects={graphObjects}
                searchPlaceholder={mapMode === "entities" ? "Search connected entities" : "Search connected architecture objects"}
                theme={mapTheme}
                connectionCounts={projection.connectionCounts}
                hiddenConnectionCounts={projection.hiddenConnectionCounts}
                summary={mapSummary}
                navigation={(
                  <ModelMapExplorer
                    trail={trail}
                    focus={focused}
                    page={projection.page}
                    pageCount={projection.pageCount}
                    neighborStart={projection.neighborStart}
                    neighborEnd={projection.neighborEnd}
                    neighborCount={projection.availableCount - 1}
                    onOverview={() => navigateModelMap({ type: "overview" })}
                    onFocus={focusOnNode}
                    onPage={(page) => navigateModelMap({ type: "page", page })}
                  />
                )}
                focusedNodeId={focused?.id ?? null}
                focusTitle={focused?.title}
                onFocusNode={focusOnNode}
                selectedNodeId={selectedRelationship ? null : selected?.id ?? null}
                selectedRelationshipId={selectedRelationship?.id ?? null}
                onSelectNode={selectNode}
                onSelectRelationship={selectRelationship}
                onClearSelection={clearSelection}
              />
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center border text-center">
                <Network className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-4 text-sm font-medium">No connected {mapMode === "entities" ? "entities" : "architecture objects"} yet</p>
                <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
                  {mapMode === "entities"
                    ? "The entity map shows entities linked to another entity. Browse all modeled entities in the catalog."
                    : "The architecture map shows objects linked to another architecture object. Browse all modeled knowledge in the catalog."}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-5">
                  <Link href={`${basePath}/model/catalog${mapMode === "entities" ? "?kind=entity" : ""}`}>Open catalog</Link>
                </Button>
              </div>
            )}
          </div>

          <Sheet
            open={Boolean(selected || (selectedRelationship && selectedRelationshipFrom && selectedRelationshipTo))}
            onOpenChange={(open) => { if (!open) clearSelection(); }}
          >
            <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[480px]">
              <div className="px-6 py-7">
            {selectedRelationship && selectedRelationshipFrom && selectedRelationshipTo ? (
              <div>
                <SheetHeader className="pr-8">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selected relationship</p>
                  <Badge variant="secondary" className="font-normal">Directed link</Badge>
                </div>
                <p className="mt-6 text-xs text-muted-foreground">Predicate</p>
                <SheetTitle className="mt-1 text-xl font-semibold tracking-tight">
                  {selectedRelationship.predicate.replaceAll("_", " ")}
                </SheetTitle>
                <SheetDescription className="mt-3 text-sm leading-6 text-muted-foreground">
                  This link records a directed dependency between two evidence-backed model objects.
                </SheetDescription>
                </SheetHeader>
                {typeof selectedRelationship.metadata.cardinality === "string" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-normal">
                      {selectedRelationship.metadata.cardinality.replaceAll("_", " ")}
                    </Badge>
                    {typeof selectedRelationship.metadata.source_attribute === "string" || typeof selectedRelationship.metadata.target_attribute === "string" ? (
                      <code className="text-xs text-muted-foreground">
                        {String(selectedRelationship.metadata.source_attribute ?? "?")} → {String(selectedRelationship.metadata.target_attribute ?? "?")}
                      </code>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-6 border-y">
                  <button
                    type="button"
                    onClick={() => selectNode(selectedRelationshipFrom.id)}
                    className="group w-full py-4 text-left"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">From · {KIND_LABELS[selectedRelationshipFrom.kind]}</span>
                    <span className="mt-1 flex items-center justify-between gap-3 text-sm font-medium group-hover:text-primary">
                      <span>{selectedRelationshipFrom.title}</span>
                      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                    </span>
                  </button>
                  <div className="flex items-center gap-2 border-y py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {selectedRelationship.predicate.replaceAll("_", " ")}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <button
                    type="button"
                    onClick={() => selectNode(selectedRelationshipTo.id)}
                    className="group w-full py-4 text-left"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">To · {KIND_LABELS[selectedRelationshipTo.kind]}</span>
                    <span className="mt-1 flex items-center justify-between gap-3 text-sm font-medium group-hover:text-primary">
                      <span>{selectedRelationshipTo.title}</span>
                      <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                    </span>
                  </button>
                </div>

                <dl className="mt-6 grid grid-cols-2 border-y text-sm">
                  <div className="py-4 pr-4">
                    <dt className="text-xs text-muted-foreground">Combined evidence</dt>
                    <dd className="mt-1 flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="size-4 text-emerald-600" />
                      {new Set([...selectedRelationshipFrom.evidence_ids, ...selectedRelationshipTo.evidence_ids]).size} excerpts
                    </dd>
                  </div>
                  <div className="border-l py-4 pl-4">
                    <dt className="text-xs text-muted-foreground">Source version</dt>
                    <dd className="mt-1 truncate font-mono text-xs font-medium">{selectedRelationshipFrom.source_version?.slice(0, 8) ?? "Current"}</dd>
                  </div>
                </dl>
              </div>
            ) : selected ? (
              <div>
                <SheetHeader className="pr-8">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selected object</p>
                  <StateBadge item={selected} />
                </div>
                <Badge variant="secondary" className="mt-5 font-normal">{KIND_LABELS[selected.kind]}</Badge>
                <SheetTitle className="mt-3 text-xl font-semibold tracking-tight">{selected.title}</SheetTitle>
                <SheetDescription className="mt-3 text-sm leading-6 text-muted-foreground">{selected.statement}</SheetDescription>
                </SheetHeader>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-6 w-full gap-2"
                  onClick={() => focusOnNode(selected.id)}
                  disabled={focused?.id === selected.id}
                >
                  <Network className="size-4" aria-hidden="true" />
                  {focused?.id === selected.id ? "Focused on this object" : "Focus on direct connections"}
                </Button>

                <dl className="mt-6 border-y text-sm">
                  <div className="py-4">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Confidence</dt>
                      <dd className="font-medium tabular-nums">{Math.round(selected.confidence * 100)}%</dd>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(selected.confidence * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 border-t">
                    <div className="py-4 pr-4">
                      <dt className="text-xs text-muted-foreground">Evidence</dt>
                      <dd className="mt-1 flex items-center gap-1.5 font-medium"><ShieldCheck className="size-4 text-emerald-600" />{selected.evidence_ids.length} verified</dd>
                    </div>
                    <div className="border-l py-4 pl-4">
                      <dt className="text-xs text-muted-foreground">Direct relations</dt>
                      <dd className="mt-1 font-medium tabular-nums">{selectedRelationships.length}</dd>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t py-3 text-xs">
                    <dt className="text-muted-foreground">Modeled by</dt>
                    <dd className="max-w-44 truncate font-medium">{String(selected.metadata.client_name ?? selected.actor ?? "Unknown")}</dd>
                  </div>
                </dl>

                {selected.subjects.length > 0 ? (
                  <div className="mt-6">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Subjects</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.subjects.map((subject) => <Badge key={subject} variant="secondary" className="font-normal">{subject}</Badge>)}
                    </div>
                  </div>
                ) : null}

                {selectedRelationships.length > 0 ? (
                  <div className="mt-6">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Direct relations</p>
                    <ul className="mt-2 divide-y border-y">
                      {selectedRelationships.map((relationship) => {
                        const otherId = relationship.from_id === selected.id ? relationship.to_id : relationship.from_id;
                        const other = graphObjects.find((item) => item.id === otherId);
                        return (
                          <li key={relationship.id} className="py-3 text-xs">
                            <button type="button" onClick={() => selectNode(otherId)} className="group w-full text-left">
                              <span className="text-muted-foreground">
                                {relationship.predicate.replaceAll("_", " ")}
                                <span className="ml-1 text-[10px]">· {relationship.from_id === selected.id ? "outgoing" : "incoming"}</span>
                              </span>
                              <span className="mt-0.5 flex items-center justify-between gap-2 font-medium">
                                <span className="truncate group-hover:text-primary">{other?.title ?? otherId}</span>
                                <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                <Button asChild variant="outline" size="sm" className="mt-7 w-full">
                  <Link href={`${basePath}/model/catalog/${encodeURIComponent(selected.id)}`}>Open details in catalog</Link>
                </Button>
              </div>
            ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </section>
      )}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t pt-5 text-xs text-muted-foreground" aria-label="Model page footer">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-foreground">Spur</span>
          <p>Review important details against source evidence.</p>
        </div>
        <nav className="flex items-center gap-1" aria-label="Model page links">
          <Button asChild variant="ghost" size="sm" className="h-8 px-3 text-xs">
            <Link href={`${basePath}/model/catalog`}>Catalog</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-8 px-3 text-xs">
            <Link href="/guide">Guide</Link>
          </Button>
        </nav>
      </footer>
    </div>
  );
}

export function ModelHealth({ workspace }: { workspace: Workspace }) {
  const basePath = `/o/${workspace.organization.slug}`;
  const { objects, relationships } = useMemo(() => modelData(workspace), [workspace]);
  const relatedIds = new Set(
    relationships.flatMap((relationship) => [relationship.from_id, relationship.to_id]),
  );
  const issueSets = [
    {
      id: "disputed",
      label: "Disputed or stale",
      description: "Knowledge that is contested or no longer current.",
      items: objects.filter((item) => item.state === "disputed" || item.state === "stale"),
    },
    {
      id: "candidates",
      label: "Candidates to review",
      description: "Modeled knowledge that has not been accepted by a person.",
      items: objects.filter((item) => item.state === "candidate"),
    },
    {
      id: "evidence",
      label: "Missing evidence",
      description: "Objects without a verified source excerpt.",
      items: objects.filter((item) => item.evidence_ids.length === 0),
    },
    {
      id: "confidence",
      label: "Low confidence",
      description: "Objects modeled below 75% confidence.",
      items: objects.filter((item) => item.confidence < 0.75),
    },
    {
      id: "disconnected",
      label: "Disconnected",
      description: "Objects that do not participate in a relationship.",
      items: objects.filter((item) => !relatedIds.has(item.id)),
    },
  ];
  const issueIds = new Set(issueSets.flatMap((issue) => issue.items.map((item) => item.id)));
  const candidates = objects.filter((item) => item.state === "candidate");
  const evidenceBacked = objects.filter((item) => item.evidence_ids.length > 0).length;
  const connected = objects.filter((item) => relatedIds.has(item.id)).length;
  const rows = MODEL_KINDS.map((kind) => {
    const kindObjects = objects.filter((item) => item.kind === kind);
    const ids = new Set(kindObjects.map((item) => item.id));
    return {
      kind,
      label: KIND_LABELS[kind],
      objects: kindObjects.length,
      share: objects.length > 0 ? Math.round((kindObjects.length / objects.length) * 100) : 0,
      confidence: kindObjects.length > 0
        ? Math.round((kindObjects.reduce((sum, item) => sum + item.confidence, 0) / kindObjects.length) * 100)
        : 0,
      evidence: new Set(kindObjects.flatMap((item) => item.evidence_ids)).size,
      relationships: relationships.filter(
        (relationship) => ids.has(relationship.from_id) || ids.has(relationship.to_id),
      ).length,
    };
  }).filter((row) => row.objects > 0);
  const evidenceCount = new Set(objects.flatMap((item) => item.evidence_ids)).size;
  const averageConfidence = objects.length > 0
    ? Math.round((objects.reduce((sum, item) => sum + item.confidence, 0) / objects.length) * 100)
    : 0;
  const evidenceCoverage = objects.length > 0 ? Math.round((evidenceBacked / objects.length) * 100) : 0;
  const relationshipCoverage = objects.length > 0 ? Math.round((connected / objects.length) * 100) : 0;
  const activeSource = workspace.sources.find(
    (source) => source.enabled && source.metadata.active === true,
  );
  const modeledVersions = new Set(objects.flatMap((item) => item.source_version ? [item.source_version] : []));
  const modelMatchesRepository =
    objects.length > 0 && modeledVersions.size === 1 && modeledVersions.has(workspace.repository.commit_sha);

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <ModelHeader workspace={workspace} active="health" />

      <section className="border-b py-5" aria-labelledby="health-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="health-heading" className="text-base font-semibold tracking-tight">Model health</h2>
            <p className="mt-1 text-xs text-muted-foreground">Evidence, connectivity and review work for the current repository version.</p>
          </div>
          <Badge
            variant={issueIds.size === 0 ? "success" : "warning"}
            className="font-normal"
          >
            {issueIds.size === 0 ? "No detected issues" : `${issueIds.size} objects need attention`}
          </Badge>
        </div>
        <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-5">
          {[
            [String(candidates.length), "Candidates to review"],
            [`${evidenceCoverage}%`, "Evidence coverage"],
            [`${relationshipCoverage}%`, "Relationship coverage"],
            [`${averageConfidence}%`, "Average confidence"],
          ].map(([value, label], index) => (
            <div key={label} className={cn("min-w-32", index > 0 && "sm:border-l sm:pl-10")}>
              <p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {objects.length === 0 ? (
        <section className="py-24 text-center">
          <Boxes className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-medium">No source model yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Health checks appear after source knowledge has been modeled.</p>
        </section>
      ) : (
        <>
          <section className="grid border-b lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]" aria-labelledby="attention-heading">
            <div className="py-8 lg:pr-10">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="attention-heading" className="text-base font-semibold tracking-tight">Attention queue</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Issues are ordered by the risk they pose to trustworthy answers.</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`${basePath}/model/catalog?kind=all`}>Review catalog</Link>
                </Button>
              </div>
              <div className="divide-y border-y">
                {issueSets.map((issue) => (
                  <div key={issue.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(180px,0.55fr)_minmax(0,1fr)] sm:items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            issue.items.length > 0 ? "bg-amber-500" : "bg-emerald-500",
                          )}
                          aria-hidden="true"
                        />
                        <p className="text-sm font-medium">{issue.label}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">{issue.items.length}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.description}</p>
                    </div>
                    {issue.items.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {issue.items.slice(0, 5).map((item) => (
                          <Link
                            key={item.id}
                            href={`${basePath}/model/catalog/${encodeURIComponent(item.id)}`}
                            className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-foreground/30 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {item.title}
                          </Link>
                        ))}
                        {issue.items.length > 5 ? (
                          <span className="self-center text-xs text-muted-foreground">+{issue.items.length - 5} more</span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-xs text-emerald-700">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Check passed
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <aside className="border-t py-8 lg:border-l lg:border-t-0 lg:pl-10" aria-labelledby="source-health-heading">
              <h2 id="source-health-heading" className="text-base font-semibold tracking-tight">Source state</h2>
              <dl className="mt-5 divide-y border-y text-sm">
                <div className="flex items-start justify-between gap-5 py-3">
                  <dt className="text-muted-foreground">Repository</dt>
                  <dd className="text-right font-medium">{workspace.repository.name}</dd>
                </div>
                <div className="flex items-start justify-between gap-5 py-3">
                  <dt className="text-muted-foreground">Current commit</dt>
                  <dd><code className="text-xs">{workspace.repository.commit_sha.slice(0, 8)}</code></dd>
                </div>
                <div className="flex items-start justify-between gap-5 py-3">
                  <dt className="text-muted-foreground">Model version</dt>
                  <dd className={cn("text-right text-xs font-medium", modelMatchesRepository ? "text-emerald-700" : "text-amber-700")}>
                    {modelMatchesRepository ? "Matches repository" : `${modeledVersions.size} other version${modeledVersions.size === 1 ? "" : "s"}`}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-5 py-3">
                  <dt className="text-muted-foreground">Last source sync</dt>
                  <dd className="text-right text-xs font-medium">
                    {activeSource?.last_synced_at
                      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activeSource.last_synced_at))
                      : "Not recorded"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-5 py-3">
                  <dt className="text-muted-foreground">Verified excerpts</dt>
                  <dd className="font-medium tabular-nums">{evidenceCount}</dd>
                </div>
              </dl>
              <Button asChild variant="ghost" size="sm" className="mt-4 -ml-3">
                <Link href={`${basePath}/sources`}>Manage source <ArrowRight className="size-4" aria-hidden="true" /></Link>
              </Button>
            </aside>
          </section>

          <section className="border-b py-8" aria-labelledby="coverage-heading">
            <div className="mb-4">
              <h2 id="coverage-heading" className="text-base font-semibold tracking-tight">Coverage by object type</h2>
              <p className="mt-1 text-xs text-muted-foreground">Distribution is context for gaps, not a target mix.</p>
            </div>
            <ModelCoverageChart objects={objects} />
          </section>

          <section className="py-8" aria-labelledby="coverage-detail-heading">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="coverage-detail-heading" className="text-base font-semibold tracking-tight">Coverage detail</h2>
                <p className="mt-1 text-xs text-muted-foreground">Evidence and connectivity for each represented object type.</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/model/catalog`}>Open catalog</Link>
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border bg-card">
              <Table>
                <TableHeader className="bg-muted/45">
                  <TableRow className="hover:bg-muted/45">
                    <TableHead>Object type</TableHead>
                    <TableHead className="text-right">Objects</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead className="text-right">Avg. confidence</TableHead>
                    <TableHead className="text-right">Evidence</TableHead>
                    <TableHead className="text-right">Relationships</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.kind}>
                      <TableCell>
                        <Link
                          href={`${basePath}/model/catalog?kind=${encodeURIComponent(row.kind)}`}
                          className="font-medium hover:text-primary hover:underline hover:underline-offset-4"
                        >
                          {row.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{row.objects}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.share}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.confidence}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.evidence}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.relationships}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function DecisionRecorder({ workspace, onRefresh }: { workspace: Workspace; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", statement: "", rationale: "", owner: workspace.actor, related: "" });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-spur-organization": workspace.organization.slug },
        body: JSON.stringify({
          title: form.title,
          statement: form.statement,
          rationale: form.rationale,
          owner: form.owner,
          related_to: form.related.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Decision could not be recorded.");
      }
      await onRefresh();
      setForm({ title: "", statement: "", rationale: "", owner: workspace.actor, related: "" });
      setOpen(false);
      setMessage("Decision recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Decision could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Record a human decision alongside modeled knowledge.</p>
        <Button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          <Plus aria-hidden="true" />Record decision
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm" role="status">{message}</p> : null}
      {open ? (
        <form onSubmit={save} className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
          <div>
            <label htmlFor="decision-title" className="mb-1.5 block text-sm font-medium">Decision title</label>
            <Input id="decision-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div>
            <label htmlFor="decision-owner" className="mb-1.5 block text-sm font-medium">Owner</label>
            <Input id="decision-owner" required value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="decision-statement" className="mb-1.5 block text-sm font-medium">Decision</label>
            <Textarea id="decision-statement" required value={form.statement} onChange={(event) => setForm({ ...form, statement: event.target.value })} />
          </div>
          <div>
            <label htmlFor="decision-rationale" className="mb-1.5 block text-sm font-medium">Rationale</label>
            <Textarea id="decision-rationale" value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} />
          </div>
          <div>
            <label htmlFor="decision-related" className="mb-1.5 block text-sm font-medium">Related subjects</label>
            <Textarea id="decision-related" value={form.related} onChange={(event) => setForm({ ...form, related: event.target.value })} placeholder="Separate names with commas" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}Save decision
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function ModelCatalog({
  workspace,
  initialQuery = "",
  initialKind = "all",
  onRefresh,
}: {
  workspace: Workspace;
  initialQuery?: string;
  initialKind?: string;
  onRefresh: () => Promise<void>;
}) {
  const basePath = `/o/${workspace.organization.slug}`;
  const objects = workspace.memory;
  const activeIds = new Set(objects.map((item) => item.id));
  const relationships = workspace.relationships.filter((relationship) =>
    activeIds.has(relationship.from_id) && activeIds.has(relationship.to_id));
  const kind = CATALOG_KINDS.includes(initialKind as MemoryKind) ? initialKind as MemoryKind : "all";
  const normalizedQuery = initialQuery.trim().toLocaleLowerCase();
  const relationCounts = new Map<string, number>();
  for (const relationship of relationships) {
    relationCounts.set(relationship.from_id, (relationCounts.get(relationship.from_id) ?? 0) + 1);
    relationCounts.set(relationship.to_id, (relationCounts.get(relationship.to_id) ?? 0) + 1);
  }
  const visible = objects.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return `${item.title} ${item.statement} ${item.subjects.join(" ")}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const visibleGroups = CATALOG_KINDS.map((groupKind) => ({
    kind: groupKind,
    items: visible.filter((item) => item.kind === groupKind),
  })).filter((group) => group.items.length > 0);
  const representedKinds = CATALOG_KINDS;
  const catalogHref = (nextKind: MemoryKind | "all", query = initialQuery) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (nextKind !== "all") params.set("kind", nextKind);
    return `${basePath}/model/catalog${params.size > 0 ? `?${params}` : ""}`;
  };

  return (
    <div className="w-full px-5 py-6 sm:px-8 sm:py-8 xl:px-10 2xl:px-12">
      <ModelHeader workspace={workspace} active="catalog" />

      <nav
        aria-label="Catalog object types"
        className="-mx-5 flex snap-x gap-1 overflow-x-auto overscroll-x-contain border-b px-5 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 lg:flex-wrap lg:overflow-visible"
      >
        {([
          { id: "all" as const, label: "All", count: objects.length },
          ...representedKinds.map((representedKind) => ({
            id: representedKind,
            label: MODEL_KIND_TAB_LABELS[representedKind] ?? KIND_LABELS[representedKind],
            count: objects.filter((item) => item.kind === representedKind).length,
          })),
        ]).map((tab) => (
          <Link
            key={tab.id}
            href={catalogHref(tab.id)}
            aria-current={kind === tab.id ? "page" : undefined}
            className={cn(
              "relative flex h-10 shrink-0 snap-start items-center gap-1.5 px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform",
              kind === tab.id && "font-medium text-foreground after:scale-x-100",
            )}
          >
            {tab.label}
            <span className="text-xs tabular-nums text-muted-foreground">{tab.count}</span>
          </Link>
        ))}
      </nav>

      {kind === "decision" && workspace.permissions?.includes("decisions.record")
        ? <DecisionRecorder workspace={workspace} onRefresh={onRefresh} />
        : null}

      <form action={`${basePath}/model/catalog`} method="get" className="flex flex-wrap items-end gap-3 border-b py-5">
        <div className="min-w-0 flex-1 basis-full sm:min-w-[240px] sm:basis-auto">
          <label htmlFor="model-query" className="mb-1.5 block text-xs font-medium text-muted-foreground">Search model</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="model-query" name="q" defaultValue={initialQuery} placeholder="Object, behavior, or subject" className="pl-9" />
          </div>
        </div>
        {kind !== "all" ? <input type="hidden" name="kind" value={kind} /> : null}
        <Button type="submit">Apply</Button>
        {initialQuery ? <Button asChild variant="ghost"><Link href={catalogHref(kind, "")}>Clear search</Link></Button> : null}
      </form>

      <div className="flex items-center justify-between gap-4 py-4 text-sm text-muted-foreground">
        <p>{visible.length} of {objects.length} catalog items</p>
        {kind !== "decision" ? <p className="hidden sm:flex sm:items-center sm:gap-1.5"><CheckCircle2 className="size-4 text-emerald-600" />Source version {workspace.repository.commit_sha.slice(0, 8)}</p> : null}
      </div>

      {visibleGroups.length > 0 ? (
        <div className="space-y-10 pb-8">
          {visibleGroups.map((group) => (
            <section key={group.kind} aria-labelledby={`catalog-${group.kind}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-t pt-6">
                <div>
                  <h2 id={`catalog-${group.kind}`} className="text-base font-semibold tracking-tight">
                    {KIND_LABELS[group.kind]}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {MODEL_KIND_DESCRIPTIONS[group.kind] ?? "Human decisions and their rationale."}
                  </p>
                </div>
                <Badge variant="secondary" className="font-normal">
                  {group.items.length} {group.items.length === 1 ? "item" : "items"}
                </Badge>
              </div>

              <div className="overflow-hidden rounded-md border bg-card">
                <Table>
                  <TableHeader className="bg-muted/45">
                    <TableRow className="hover:bg-muted/45">
                      <TableHead className="min-w-0 sm:min-w-[360px]">Object</TableHead>
                      <TableHead className="hidden sm:table-cell">Status</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Confidence</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Evidence</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Relations</TableHead>
                      <TableHead className="hidden xl:table-cell">Provenance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item, index) => (
                      <TableRow key={item.id} className="animate-model-row" style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
                        <TableCell className="max-w-[620px] whitespace-normal">
                          <Link href={`${basePath}/model/catalog/${encodeURIComponent(item.id)}`} className="font-medium hover:text-primary hover:underline hover:underline-offset-4">{item.title}</Link>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.statement}</p>
                          <div className="mt-2 sm:hidden"><StateBadge item={item} /></div>
                          {item.subjects.length > 0 ? <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{item.subjects.join(" · ")}</p> : null}
                          {item.kind === "entity" && entityDefinitionSchema.safeParse(item.metadata.entity_definition).success ? (() => {
                            const definition = entityDefinitionSchema.parse(item.metadata.entity_definition);
                            return (
                              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                                <span>{definition.attributes.length} attributes</span>
                                <span aria-hidden="true">·</span>
                                <span>{definition.data_locations.length} locations</span>
                                {definition.information_classification ? (
                                  <><span aria-hidden="true">·</span><span>{definition.information_classification}</span></>
                                ) : null}
                              </div>
                            );
                          })() : null}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell"><StateBadge item={item} /></TableCell>
                        <TableCell className="hidden text-right font-medium tabular-nums sm:table-cell">{Math.round(item.confidence * 100)}%</TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{item.evidence_ids.length}</TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">{relationCounts.get(item.id) ?? 0}</TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <p className="max-w-44 truncate text-xs font-medium">{String(item.metadata.client_name ?? item.actor ?? "Unknown")}</p>
                          <p className="mt-1 max-w-44 truncate text-[11px] text-muted-foreground">{item.kind === "decision" && item.authority === "person" ? "Human decision" : String(item.metadata.reported_model ?? "Model not reported")}</p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="border-y py-20 text-center">
          <p className="text-sm font-medium">No modeled objects match</p>
          <p className="mt-1 text-xs text-muted-foreground">Change the search or object type filter.</p>
        </div>
      )}
    </div>
  );
}
