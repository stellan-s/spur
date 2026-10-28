import { describe, expect, it, vi } from "vitest";

import { GitHubSource } from "@/core/source-provider";

const SHA = "a".repeat(40);
const FILE = "export const limit = 4;\nexport function allowed(value: number) {\n  return value <= limit;\n}\n";

function githubFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer installation-token");
    if (url.pathname === "/repos/acme/portal") {
      return Response.json({ full_name: "acme/portal", html_url: "https://github.com/acme/portal", default_branch: "main" });
    }
    if (url.pathname === "/repos/acme/portal/commits/main") return Response.json({ sha: SHA });
    if (url.pathname === `/repos/acme/portal/commits/${SHA}`) return Response.json({ sha: SHA });
    if (url.pathname === `/repos/acme/portal/git/trees/${SHA}`) {
      expect(url.searchParams.get("recursive")).toBe("1");
      return Response.json({ tree: [
        { path: "src/rules.ts", type: "blob", size: Buffer.byteLength(FILE) },
        { path: ".env", type: "blob", size: 20 },
      ], truncated: false });
    }
    if (url.pathname === "/repos/acme/portal/contents/src/rules.ts") {
      expect(url.searchParams.get("ref")).toBe(SHA);
      return Response.json({ type: "file", encoding: "base64", size: Buffer.byteLength(FILE), content: Buffer.from(FILE).toString("base64") });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  });
}

describe("GitHub source provider", () => {
  it("reads and verifies exact excerpts at a pinned commit without a checkout", async () => {
    const request = githubFetch();
    const source = new GitHubSource("acme", "portal", "installation-token", "https://api.github.test", request as typeof fetch);

    await expect(source.metadata()).resolves.toEqual({
      name: "acme/portal",
      commitSha: SHA,
      remoteUrl: "https://github.com/acme/portal",
    });
    await expect(source.hasCommit(SHA)).resolves.toBe(true);
    await expect(source.listFilesAtCommit(SHA)).resolves.toEqual([
      { path: "src/rules.ts", size: Buffer.byteLength(FILE) },
    ]);
    await expect(source.searchFilesAtCommit(SHA, ["allowed", "limit"])).resolves.toEqual([
      { path: "src/rules.ts", matchedTerms: 2, lineNumbers: [1, 2, 3] },
    ]);
    await expect(source.checkExcerpt({
      commitSha: SHA,
      path: "src/rules.ts",
      startLine: 2,
      endLine: 3,
      excerpt: "export function allowed(value: number) {\n  return value <= limit;",
    })).resolves.toEqual({ ok: true });
    await expect(source.checkExcerpt({
      commitSha: SHA,
      path: "src/rules.ts",
      startLine: 2,
      endLine: 3,
      excerpt: "changed\ntext",
    })).resolves.toMatchObject({ ok: false });
  });
});
