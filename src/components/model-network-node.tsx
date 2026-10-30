import type { ReactNode } from "react";

import type { MemoryObject } from "@/core/memory-types";
import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/model-graph-layout";
import { modelKindColor } from "@/lib/model-map-theme";
import { NETWORK_DOT_Y, networkNodeRadius } from "@/lib/model-network";
import { cn } from "@/lib/utils";

export function ModelNetworkNode({
  item, selected, focused, muted, connectionCount, hiddenConnectionCount = 0, onExplore, onDetails, children,
}: {
  item: MemoryObject;
  selected?: boolean;
  focused?: boolean;
  muted: boolean;
  connectionCount: number;
  hiddenConnectionCount?: number;
  onExplore?: () => void;
  onDetails?: () => void;
  children?: ReactNode;
}) {
  const radius = networkNodeRadius(connectionCount);
  return (
    <div
      className={cn("group relative cursor-pointer text-center transition-opacity duration-150 motion-reduce:transition-none", muted && "opacity-35")}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      title={`${item.title} · ${item.kind} · ${connectionCount} ${connectionCount === 1 ? "connection" : "connections"}`}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          "absolute rounded-full border-2 border-background shadow-sm transition-[box-shadow,scale] duration-150 group-hover:scale-110 motion-reduce:transition-none",
          (selected || focused) && "ring-4 ring-foreground/20 ring-offset-2 ring-offset-card",
        )}
        style={{ left: NODE_WIDTH / 2 - radius, top: NETWORK_DOT_Y - radius, width: radius * 2, height: radius * 2, backgroundColor: modelKindColor(item.kind) }}
      />
      <div className="absolute inset-x-2 top-[46px]">
        <p className={cn("mx-auto line-clamp-2 w-fit max-w-full rounded-sm bg-card/95 px-1.5 text-[13px] leading-4 text-foreground", selected ? "font-semibold" : "font-medium")}>{item.title}</p>
        <div className="flex items-center justify-center gap-1 text-[11px] leading-[14px]">
          {focused ? <span className="rounded-sm bg-card/95 px-1.5 text-muted-foreground">Current focus</span> : onExplore ? (
            <button
              type="button"
              className="nodrag nopan rounded-sm bg-card/95 px-1.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Explore connections for ${item.title}${hiddenConnectionCount > 0 ? ` (${hiddenConnectionCount} hidden)` : ""}`}
              onClick={(event) => { event.stopPropagation(); onExplore(); }}
              onDoubleClick={(event) => event.stopPropagation()}
            >Explore</button>
          ) : null}
          {onDetails ? (
            <button type="button"
              className="nodrag nopan rounded-sm bg-card/95 px-1.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`View details for ${item.title}`}
              onClick={(event) => { event.stopPropagation(); onDetails(); }}
              onDoubleClick={(event) => event.stopPropagation()}
            >Details</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
