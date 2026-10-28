import type { MapPresentation } from "@/lib/model-network";

export type MapMode = "entities" | "architecture";
export type MapTrailStep = { id: string; page: number };

export function readMapTrail(params: Pick<URLSearchParams, "get">): MapTrailStep[] {
  try {
    const value: unknown = JSON.parse(params.get("trail") ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.slice(-32).filter((step): step is MapTrailStep => {
      if (!step || typeof step.id !== "string" || !step.id || step.id.length > 256 ||
        !Number.isSafeInteger(step.page) || step.page < 0 || seen.has(step.id)) return false;
      seen.add(step.id);
      return true;
    }).map(({ id, page }) => ({ id, page }));
  } catch {
    return [];
  }
}

type MapNavigation =
  | { type: "mode"; mode: MapMode }
  | { type: "presentation"; presentation: MapPresentation }
  | { type: "selection"; key: "selected" | "relationship"; id: string }
  | { type: "clear-selection" }
  | { type: "focus"; id: string }
  | { type: "page"; page: number }
  | { type: "overview" };

export function navigateModelMap(action: MapNavigation): void {
  // Map controls only change already-loaded data. Native history keeps Next's
  // search params in sync without another server/authentication round trip.
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  const original = params.toString();
  const clearSelection = () => {
    params.delete("selected");
    params.delete("relationship");
  };
  const clearFocus = () => {
    params.delete("focus");
    params.delete("page");
    params.delete("trail");
    params.delete("limit");
    params.delete("scope");
    clearSelection();
  };
  switch (action.type) {
    case "mode": {
      const mode = params.get("map") === "architecture" ? "architecture" : "entities";
      if (action.mode === mode) return;
      params.set("map", action.mode);
      clearFocus();
      break;
    }
    case "presentation":
      if (action.presentation === "cards") params.set("style", "cards");
      else params.delete("style");
      break;
    case "selection": {
      const selected = params.get(action.key) === action.id;
      clearSelection();
      if (!selected) params.set(action.key, action.id);
      break;
    }
    case "clear-selection":
      clearSelection();
      break;
    case "focus": {
      const currentId = params.get("focus");
      if (currentId === action.id) return;
      const trail = readMapTrail(params);
      const previousIndex = trail.findIndex((step) => step.id === action.id);
      let page = 0;
      let nextTrail: MapTrailStep[];
      if (previousIndex >= 0) {
        page = trail[previousIndex].page;
        nextTrail = trail.slice(0, previousIndex);
      } else {
        const currentPage = Number(params.get("page"));
        nextTrail = currentId ? [...trail, {
          id: currentId,
          page: Number.isSafeInteger(currentPage) && currentPage > 0 ? currentPage : 0,
        }].slice(-32) : [];
      }
      clearFocus();
      params.set("focus", action.id);
      if (page > 0) params.set("page", String(page));
      if (nextTrail.length) params.set("trail", JSON.stringify(nextTrail));
      break;
    }
    case "page":
      if (!params.has("focus")) return;
      clearSelection();
      params.delete("limit");
      params.delete("scope");
      if (Number.isSafeInteger(action.page) && action.page > 0) params.set("page", String(action.page));
      else params.delete("page");
      break;
    case "overview":
      clearFocus();
      break;
  }
  const query = params.toString();
  if (query === original) return;
  const href = `${pathname}${query ? `?${query}` : ""}${hash}`;
  if (action.type === "mode" || action.type === "focus" || action.type === "overview" || action.type === "page") {
    window.history.pushState(null, "", href);
  } else {
    window.history.replaceState(null, "", href);
  }
}
