import { describe, expect, it } from "vitest";

import { isMapThemeId, MAP_THEMES, modelKindColor } from "@/lib/model-map-theme";

describe("model map themes", () => {
  it("exposes the supported palettes in display order", () => {
    expect(MAP_THEMES.map((theme) => theme.id)).toEqual([
      "auto", "github-light", "github-dark", "nord", "dracula",
    ]);
  });

  it("accepts only persisted theme identifiers", () => {
    expect(isMapThemeId("nord")).toBe(true);
    expect(isMapThemeId("unknown")).toBe(false);
    expect(isMapThemeId(null)).toBe(false);
  });

  it("maps entity kinds to map-scoped CSS variables", () => {
    expect(modelKindColor("entity")).toBe("var(--map-kind-entity)");
  });
});
