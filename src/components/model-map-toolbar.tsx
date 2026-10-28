import type { ReactNode } from "react";
import { Check, Columns3, LayoutGrid, Maximize2, Minimize2, Minus, Plus, Rows3, Scan, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MapPresentation } from "@/lib/model-network";

export type LayoutMode = "balanced" | "LR" | "TB";

export function ModelMapToolbar({
  navigation, expanded, onToggleExpanded, presentation, onPresentationChange,
  layout, onLayoutChange, searchPlaceholder, query, onQueryChange, results, onFocusResult,
  viewportReady, onZoomIn, onZoomOut, onFitView,
}: {
  navigation: ReactNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  presentation: MapPresentation;
  onPresentationChange: (presentation: MapPresentation) => void;
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  results: { id: string; title: string }[];
  onFocusResult: (id: string) => void;
  viewportReady: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  return (
    <div className="relative z-20 shrink-0 border-b bg-background px-3 py-2" role="region" aria-label="Map controls">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{navigation}</div>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs"
          onClick={onToggleExpanded} aria-label={expanded ? "Exit full screen" : "Expand map to full screen"}
          aria-pressed={expanded} title={expanded ? "Exit full screen" : "Full screen"}>
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          <span className="hidden sm:inline">{expanded ? "Exit full screen" : "Full screen"}</span>
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/50 p-0.5" role="group" aria-label="Node display">
          {(["network", "cards"] as const).map((value) => (
            <Button key={value} type="button" variant="ghost" size="sm"
              className={`h-8 gap-1.5 border px-2.5 text-xs ${presentation === value ? "border-primary/60 bg-primary/15 font-semibold text-foreground shadow-xs hover:bg-primary/20 hover:text-foreground" : "border-transparent text-muted-foreground"}`} aria-pressed={presentation === value} onClick={() => onPresentationChange(value)}>
              {value === "network" ? "Network" : "Cards"}
              <Check className={presentation === value ? "" : "invisible"} aria-hidden="true" />
            </Button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/50 p-0.5" role="group" aria-label="Map layout">
          {([
            { value: "balanced", label: "Connected", icon: LayoutGrid },
            { value: "LR", label: "Horizontal", icon: Columns3 },
            { value: "TB", label: "Vertical", icon: Rows3 },
          ] as const).map(({ value, label, icon: Icon }) => (
            <Button key={value} type="button" variant="ghost" size="sm"
              className={`h-8 gap-1.5 border px-2.5 text-xs ${layout === value ? "border-primary/60 bg-primary/15 font-semibold text-foreground shadow-xs hover:bg-primary/20 hover:text-foreground" : "border-transparent text-muted-foreground"}`} onClick={() => onLayoutChange(value)}
              aria-label={`${label} layout`} aria-pressed={layout === value} title={`${label} layout`}>
              <Icon aria-hidden="true" /><span className="hidden md:inline">{label}</span>
              <Check className={layout === value ? "" : "invisible"} aria-hidden="true" />
            </Button>
          ))}
        </div>
        <div className="relative min-w-40 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label={searchPlaceholder} placeholder={searchPlaceholder}
            value={query} onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) onFocusResult(results[0].id);
              if (event.key === "Escape") {
                event.stopPropagation();
                onQueryChange("");
              }
            }}
            className="h-9 bg-background pl-8 text-xs shadow-none"
          />
          {query.trim() ? (
            <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
              {results.length > 0 ? results.map((item) => (
                <button key={item.id} type="button"
                  className="block w-full truncate rounded-sm px-2.5 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => onFocusResult(item.id)}>{item.title}</button>
              )) : <p className="px-2.5 py-2 text-xs text-muted-foreground">No matching connected nodes</p>}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5" role="group" aria-label="Map zoom">
          <Button type="button" variant="ghost" size="icon" className="size-9" disabled={!viewportReady}
            aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}><Minus aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-9" disabled={!viewportReady}
            aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}><Plus aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-9" disabled={!viewportReady}
            aria-label="Fit map to view" title="Fit map to view" onClick={onFitView}><Scan aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  );
}
