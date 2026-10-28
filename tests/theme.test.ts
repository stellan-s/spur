import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function themeColors(selector: string) {
  const block = stylesheet.slice(stylesheet.indexOf(`${selector} {`)).split("}")[0];
  const tokens = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
  const resolve = (name: string): string => {
    const value = tokens[name];
    if (!value) throw new Error(`Missing theme color: ${name}`);
    const reference = /^var\((--[\w-]+)\)$/.exec(value);
    return reference ? resolve(reference[1]) : value;
  };
  return resolve;
}

function luminance(hex: string) {
  if (!/^#[a-f0-9]{6}$/i.test(hex)) throw new Error(`Expected an opaque hex color: ${hex}`);
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

const textPairs = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
  ["--muted-foreground", "--muted"],
  ["--primary-foreground", "--primary"],
  ["--primary-foreground", "--brand-hover"],
  ["--primary", "--background"],
  ["--primary", "--card"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-primary-foreground", "--sidebar-primary"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  ["--map-label", "--map-label-bg"],
  ["--map-label-active", "--map-label-bg"],
];

describe.each([
  { selector: ":root", background: "#eaf0f7", surface: "#ffffff", accent: "#305bd5" },
  { selector: ".dark", background: "#151c28", surface: "#202a39", accent: "#a2beff" },
])("Mist and cobalt ($selector)", ({ selector, background, surface, accent }) => {
  const color = themeColors(selector);

  it("uses the selected palette for the workspace, surfaces and actions", () => {
    expect(color("--background")).toBe(background);
    expect(color("--card")).toBe(surface);
    expect(color("--sidebar")).toBe(surface);
    expect(color("--primary")).toBe(accent);
    expect(color("--map-edge-active")).toBe(accent);
  });

  it.each(textPairs)("keeps normal-text contrast at least 4.5:1 for %s on %s", (foreground, background) => {
    const values = [luminance(color(foreground)), luminance(color(background))];
    const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
