import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateModelMap, readMapTrail } from "@/lib/model-map-navigation";

function browser(query = "") {
  const location = new URL(`http://localhost:3003/o/northstar/model${query}`);
  const entries = [location.href];
  let index = 0;
  const history = {
    pushState: vi.fn((_state: unknown, _title: string, href: string) => {
      location.href = new URL(href, location).href;
      entries.splice(index + 1, entries.length, location.href);
      index++;
    }),
    replaceState: vi.fn((_state: unknown, _title: string, href: string) => {
      location.href = new URL(href, location).href;
      entries[index] = location.href;
    }),
    back: () => { location.href = entries[index = Math.max(0, index - 1)]; },
    forward: () => { location.href = entries[index = Math.min(entries.length - 1, index + 1)]; },
  };
  vi.stubGlobal("window", { location, history });
  return { location, history };
}

afterEach(() => vi.unstubAllGlobals());

describe("local map navigation", () => {
  it("switches modes immediately in native history while retaining the presentation", () => {
    const { location, history } = browser("?map=entities&style=cards&scope=all&focus=entity-1&limit=40&selected=entity-2");
    navigateModelMap({ type: "mode", mode: "architecture" });
    expect(location.search).toBe("?map=architecture&style=cards");
    expect(location.pathname).toBe("/o/northstar/model");
    expect(history.pushState).toHaveBeenCalledWith(null, "", `${location.pathname}${location.search}`);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("handles rapid back-and-forth switches from the current URL, not stale render state", () => {
    const { location, history } = browser("?map=architecture");
    navigateModelMap({ type: "mode", mode: "entities" });
    navigateModelMap({ type: "mode", mode: "architecture" });
    navigateModelMap({ type: "mode", mode: "entities" });
    expect(location.search).toBe("?map=entities");
    expect(history.pushState).toHaveBeenCalledTimes(3);
  });

  it("clears architecture relationship focus when returning to the entity overview", () => {
    const { location } = browser("?map=architecture&focus=system-1&relationship=link-1&scope=all&limit=60");
    navigateModelMap({ type: "mode", mode: "entities" });
    expect(location.search).toBe("?map=entities");
  });

  it("does not create duplicate entries for the current mode, including the default", () => {
    const { history } = browser();
    navigateModelMap({ type: "mode", mode: "entities" });
    navigateModelMap({ type: "mode", mode: "architecture" });
    navigateModelMap({ type: "mode", mode: "architecture" });
    expect(history.pushState).toHaveBeenCalledTimes(1);
  });

  it("keeps focus, selection and mode when changing presentation without a server navigation", () => {
    const { location, history } = browser("?map=entities&focus=entity-1&selected=entity-2#map");
    navigateModelMap({ type: "presentation", presentation: "cards" });
    expect(location.searchParams.get("focus")).toBe("entity-1");
    expect(location.searchParams.get("selected")).toBe("entity-2");
    expect(location.searchParams.get("style")).toBe("cards");
    expect(location.hash).toBe("#map");
    navigateModelMap({ type: "presentation", presentation: "network" });
    expect(location.search).toBe("?map=entities&focus=entity-1&selected=entity-2");
    expect(history.replaceState).toHaveBeenCalledTimes(2);
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("preserves a just-selected presentation through a mode change and node click", () => {
    const { location } = browser("?map=entities");
    navigateModelMap({ type: "presentation", presentation: "cards" });
    navigateModelMap({ type: "mode", mode: "architecture" });
    navigateModelMap({ type: "selection", key: "selected", id: "system-1" });
    expect(location.searchParams.get("map")).toBe("architecture");
    expect(location.searchParams.get("style")).toBe("cards");
    expect(location.searchParams.get("selected")).toBe("system-1");
  });

  it("keeps the trail and paging when switching to Network and continuing exploration", () => {
    const { location } = browser("?map=entities&style=cards");
    navigateModelMap({ type: "focus", id: "A" });
    navigateModelMap({ type: "page", page: 2 });
    navigateModelMap({ type: "focus", id: "B" });
    navigateModelMap({ type: "page", page: 1 });
    const trail = readMapTrail(location.searchParams);
    navigateModelMap({ type: "presentation", presentation: "network" });
    expect(location.searchParams.has("style")).toBe(false);
    expect(location.searchParams.get("focus")).toBe("B");
    expect(location.searchParams.get("page")).toBe("1");
    expect(readMapTrail(location.searchParams)).toEqual(trail);
    navigateModelMap({ type: "focus", id: "C" });
    navigateModelMap({ type: "focus", id: "B" });
    expect(location.searchParams.get("page")).toBe("1");
    expect(readMapTrail(location.searchParams)).toEqual([{ id: "A", page: 2 }]);
  });

  it("toggles details locally and never keeps both node and relationship selections", () => {
    const { location, history } = browser("?map=entities&focus=entity-1&style=cards");
    navigateModelMap({ type: "selection", key: "selected", id: "entity-1" });
    navigateModelMap({ type: "selection", key: "relationship", id: "link-1" });
    expect(location.searchParams.has("selected")).toBe(false);
    expect(location.searchParams.get("relationship")).toBe("link-1");
    navigateModelMap({ type: "selection", key: "relationship", id: "link-1" });
    expect(location.searchParams.has("relationship")).toBe(false);
    expect(location.searchParams.get("focus")).toBe("entity-1");
    navigateModelMap({ type: "selection", key: "selected", id: "entity-2" });
    navigateModelMap({ type: "clear-selection" });
    expect(location.searchParams.has("selected")).toBe(false);
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("persists the trail and each step's neighbour page across reloads", () => {
    const { location, history } = browser("?map=entities&style=cards&selected=entity-1");
    navigateModelMap({ type: "focus", id: "entity-1" });
    navigateModelMap({ type: "page", page: 2 });
    expect(location.searchParams.has("selected")).toBe(false);
    navigateModelMap({ type: "focus", id: "entity-2" });
    expect(location.searchParams.has("page")).toBe(false);
    expect(readMapTrail(location.searchParams)).toEqual([{ id: "entity-1", page: 2 }]);
    const reloaded = browser(location.search);
    navigateModelMap({ type: "focus", id: "entity-1" });
    expect(reloaded.location.searchParams.get("page")).toBe("2");
    expect(readMapTrail(reloaded.location.searchParams)).toEqual([]);
    expect(history.pushState).toHaveBeenCalledTimes(3);
  });

  it("returns to any earlier step without creating a loop in the trail", () => {
    const { location } = browser("?map=entities&style=cards");
    for (const id of ["A", "B", "C", "D"]) navigateModelMap({ type: "focus", id });
    expect(readMapTrail(location.searchParams).map((step) => step.id)).toEqual(["A", "B", "C"]);
    navigateModelMap({ type: "focus", id: "B" });
    expect(readMapTrail(location.searchParams).map((step) => step.id)).toEqual(["A"]);
    navigateModelMap({ type: "focus", id: "E" });
    expect(readMapTrail(location.searchParams).map((step) => step.id)).toEqual(["A", "B"]);
    navigateModelMap({ type: "overview" });
    expect(location.search).toBe("?map=entities&style=cards");
  });

  it("restores focus, trail and neighbour page through browser back and forward", () => {
    const { location, history } = browser("?map=architecture");
    navigateModelMap({ type: "focus", id: "A" });
    navigateModelMap({ type: "page", page: 1 });
    navigateModelMap({ type: "focus", id: "B" });
    const destination = location.search;
    history.back();
    expect(location.search).toBe("?map=architecture&focus=A&page=1");
    history.back();
    expect(location.search).toBe("?map=architecture&focus=A");
    history.forward();
    history.forward();
    expect(location.search).toBe(destination);
    expect(readMapTrail(location.searchParams)).toEqual([{ id: "A", page: 1 }]);
  });

  it("clears legacy full-map and growth parameters on exploration and overview", () => {
    const { location } = browser("?map=architecture&style=cards&scope=all&focus=system-1&limit=999&selected=system-2");
    navigateModelMap({ type: "focus", id: "system-2" });
    expect(location.searchParams.has("scope")).toBe(false);
    expect(location.searchParams.has("limit")).toBe(false);
    expect(location.searchParams.has("selected")).toBe(false);
    navigateModelMap({ type: "overview" });
    expect(location.search).toBe("?map=architecture&style=cards");
  });

  it("resets exploration when switching map modes but preserves presentation", () => {
    const { location } = browser("?map=architecture&style=cards");
    navigateModelMap({ type: "focus", id: "A" });
    navigateModelMap({ type: "focus", id: "B" });
    navigateModelMap({ type: "page", page: 3 });
    navigateModelMap({ type: "mode", mode: "entities" });
    expect(location.search).toBe("?map=entities&style=cards");
  });

  it("ignores repeated focus and normalizes pages without leaving the focus", () => {
    const { location, history } = browser("?focus=A&page=2&relationship=link-1");
    navigateModelMap({ type: "focus", id: "A" });
    expect(history.pushState).not.toHaveBeenCalled();
    navigateModelMap({ type: "page", page: -1 });
    expect(location.search).toBe("?focus=A");
    navigateModelMap({ type: "page", page: NaN });
    expect(history.pushState).toHaveBeenCalledTimes(1);
    navigateModelMap({ type: "overview" });
    navigateModelMap({ type: "page", page: 1 });
    expect(location.search).toBe("");
  });

  it("keeps exploration history bounded and ignores malformed trail values", () => {
    const { location } = browser();
    for (let i = 0; i < 40; i++) navigateModelMap({ type: "focus", id: `node-${i}` });
    expect(readMapTrail(location.searchParams)).toHaveLength(32);
    expect(readMapTrail(location.searchParams).at(-1)?.id).toBe("node-38");
    for (const trail of ["not-json", "null", "{}", "[null, false, 42]", '[{"id":"A","page":-1}]']) {
      expect(readMapTrail(new URLSearchParams({ trail }))).toEqual([]);
    }
    expect(readMapTrail(new URLSearchParams({ trail: JSON.stringify([
      { id: "A", page: 1, extra: "discard" }, { id: "A", page: 2 }, { id: "B", page: 0 },
    ]) }))).toEqual([{ id: "A", page: 1 }, { id: "B", page: 0 }]);
  });
});
