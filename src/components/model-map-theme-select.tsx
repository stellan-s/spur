import { Palette } from "lucide-react";

import { MAP_THEMES, type MapThemeId } from "@/lib/model-map-theme";

export function ModelMapThemeSelect({
  value,
  onChange,
}: {
  value: MapThemeId;
  onChange: (theme: MapThemeId) => void;
}) {
  return (
    <div className="relative shrink-0">
      <Palette className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label="Map theme"
        value={value}
        onChange={(event) => onChange(event.target.value as MapThemeId)}
        className="h-9 min-w-36 rounded-md border bg-background py-1 pl-8 pr-8 text-xs text-foreground shadow-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {MAP_THEMES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </div>
  );
}
