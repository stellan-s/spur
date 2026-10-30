import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isMapThemeId, MAP_THEMES, modelKindColor } from "@/lib/model-map-theme";

function themeVariables(css: string, themeId: string) {
  const block = new RegExp(`\\[data-map-theme="${themeId}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1];
  expect(block, `Missing CSS block for ${themeId}`).toBeDefined();
  const variables = new Map<string, string>();
  for (const match of block!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    variables.set(match[1], match[2].trim());
  }
  return variables;
}

function resolveColour(variables: Map<string, string>, name: string, visited = new Set<string>()): string {
  if (visited.has(name)) throw new Error(`Circular CSS variable reference: ${name}`);
  const value = variables.get(name);
  if (!value) throw new Error(`Missing CSS variable: ${name}`);
  const reference = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (!reference) return value;
  visited.add(name);
  return resolveColour(variables, reference[1], visited);
}

function relativeLuminance(hex: string): number {
  const digits = hex.replace("#", "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(digits)) throw new Error(`Unsupported colour: ${hex}`);
  const expanded = digits.length === 3 ? [...digits].map((digit) => digit.repeat(2)).join("") : digits;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("model map themes", () => {
  it("exposes the supported palettes in display order", () => {
    expect(MAP_THEMES.map((theme) => theme.id)).toEqual([
      "auto", "github-light", "github-dark", "nord", "dracula",
      "solarized-light", "solarized-dark", "gruvbox-light", "gruvbox-dark",
      "tokyo-night", "catppuccin-mocha", "rose-pine", "phosphor", "amber-terminal",
    ]);
  });

  it("accepts only persisted theme identifiers", () => {
    expect(isMapThemeId("nord")).toBe(true);
    expect(isMapThemeId("tokyo-night")).toBe(true);
    expect(isMapThemeId("amber-terminal")).toBe(true);
    expect(isMapThemeId("unknown")).toBe(false);
    expect(isMapThemeId(null)).toBe(false);
  });

  it("maps entity kinds to map-scoped CSS variables", () => {
    expect(modelKindColor("entity")).toBe("var(--map-kind-entity)");
  });

  it("defines a scoped CSS palette for every explicit theme", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    for (const theme of MAP_THEMES) {
      if (theme.id === "auto") continue;
      expect(css).toContain(`[data-map-theme="${theme.id}"]`);
    }
  });

  it("keeps normal text at WCAG AA contrast in every explicit theme", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const pairs = [
      ["foreground", "background"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
      ["muted-foreground", "background"],
      ["muted-foreground", "card"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["accent-foreground", "accent"],
    ] as const;

    for (const theme of MAP_THEMES) {
      if (theme.id === "auto") continue;
      const variables = themeVariables(css, theme.id);
      for (const [foreground, background] of pairs) {
        const ratio = contrastRatio(
          resolveColour(variables, foreground),
          resolveColour(variables, background),
        );
        expect(
          ratio,
          `${theme.label}: --${foreground} on --${background} has ${ratio.toFixed(2)}:1 contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
