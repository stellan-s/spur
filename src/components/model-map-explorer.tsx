import { ArrowLeft, Check, ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type TrailItem = { id: string; title: string };

export function ModelMapExplorer({
  trail, focus, page, pageCount, neighborStart, neighborEnd, neighborCount,
  onOverview, onFocus, onPage,
}: {
  trail: TrailItem[];
  focus?: TrailItem;
  page: number;
  pageCount: number;
  neighborStart: number;
  neighborEnd: number;
  neighborCount: number;
  onOverview: () => void;
  onFocus: (id: string) => void;
  onPage: (page: number) => void;
}) {
  const previous = trail.at(-1);
  const earlier = trail.slice(0, -2);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <nav className="flex min-w-0 items-center gap-1" aria-label="Map exploration trail">
        {focus ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs"
            aria-label={previous ? `Back to ${previous.title}` : "Back to overview"}
            onClick={() => previous ? onFocus(previous.id) : onOverview()}>
            <ArrowLeft aria-hidden="true" /><span className="hidden sm:inline">Back</span>
          </Button>
        ) : null}
        <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <li>
            <Badge asChild variant="outline"
              className={`h-8 cursor-pointer rounded-full px-3 ${focus ? "border-primary/15 bg-primary/5 hover:bg-primary/10" : "border-primary/60 bg-primary/15 font-semibold shadow-xs hover:bg-primary/20"}`}>
              <button type="button" aria-current={!focus ? "location" : undefined} onClick={onOverview}>
                {!focus ? <Check className="shrink-0" aria-hidden="true" /> : null}Overview
              </button>
            </Badge>
          </li>
          {focus && earlier.length > 0 ? (
            <li className="flex items-center gap-1.5">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <details key={focus.id} className="relative">
                <Badge asChild variant="outline" className="h-8 cursor-pointer list-none rounded-full border-primary/15 bg-primary/5 px-3 hover:bg-primary/10 [&::-webkit-details-marker]:hidden">
                  <summary aria-label="Earlier exploration steps" title="Earlier exploration steps">
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </summary>
                </Badge>
                <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
                  {earlier.map((item) => (
                    <Button key={item.id} type="button" variant="ghost" size="sm" className="w-full justify-start text-xs"
                      title={item.title} onClick={() => onFocus(item.id)}>
                      <span className="truncate">{item.title}</span>
                    </Button>
                  ))}
                </div>
              </details>
            </li>
          ) : null}
          {focus ? trail.slice(-2).map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Badge asChild variant="outline" className="h-8 max-w-28 cursor-pointer rounded-full border-primary/15 bg-primary/5 px-3 hover:bg-primary/10 sm:max-w-40">
                <button type="button" title={item.title} onClick={() => onFocus(item.id)}>
                  <span className="truncate">{item.title}</span>
                </button>
              </Badge>
            </li>
          )) : null}
          {focus ? (
            <li className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Badge variant="outline" className="h-8 max-w-36 rounded-full border-primary/60 bg-primary/15 px-3 font-semibold shadow-xs sm:max-w-56" title={focus.title} aria-current="location">
                <Check className="shrink-0" aria-hidden="true" />
                <span className="truncate">{focus.title}</span>
              </Badge>
            </li>
          ) : null}
        </ol>
      </nav>
      {focus && pageCount > 1 ? (
        <div className="flex items-center gap-1" role="group" aria-label="Browse neighbours">
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
            aria-label="Previous neighbours" disabled={page === 0} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-live="polite">
            Neighbours {neighborStart}–{neighborEnd} of {neighborCount}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
            aria-label="Next neighbours" disabled={page === pageCount - 1} onClick={() => onPage(page + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
