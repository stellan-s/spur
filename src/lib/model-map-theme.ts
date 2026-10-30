import type { MemoryKind } from "@/core/memory-types";

export const MAP_THEME_STORAGE_KEY = "spur-map-theme";

export const MAP_THEMES = [
  { id: "auto", label: "Auto" },
  { id: "github-light", label: "GitHub Light" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "nord", label: "Nord" },
  { id: "dracula", label: "Dracula" },
] as const;

export type MapThemeId = typeof MAP_THEMES[number]["id"];

const MAP_THEME_IDS = new Set<string>(MAP_THEMES.map((theme) => theme.id));

export function isMapThemeId(value: string | null): value is MapThemeId {
  return value !== null && MAP_THEME_IDS.has(value);
}

export function modelKindColor(kind: MemoryKind): string {
  return `var(--map-kind-${kind})`;
}
