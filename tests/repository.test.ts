import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LIMITS } from "@/core/config";
import { GitRepository, assertSafeRelativePath, isExcludedPath } from "@/core/repository";

const fixtureRoot = path.resolve(process.cwd(), "fixture-repo");

describe("repository path policy", () => {
  it("accepts only relative paths contained by the configured root", () => {
    expect(assertSafeRelativePath("src/orders.ts")).toBe("src/orders.ts");
    expect(() => assertSafeRelativePath("../outside.ts")).toThrow(/escapes/);
    expect(() => assertSafeRelativePath("/etc/passwd")).toThrow(/safe relative/);
    expect(() => assertSafeRelativePath("C:\\secrets.txt")).toThrow(/safe relative/);
  });

  it("excludes secrets, credentials, generated output, and vendor code", () => {
    expect(isExcludedPath(".env.production")).toBe(true);
    expect(isExcludedPath("config/client-secret.json")).toBe(true);
    expect(isExcludedPath("keys/private-key.pem")).toBe(true);
    expect(isExcludedPath("node_modules/library/index.ts")).toBe(true);
    expect(isExcludedPath("vendor/ignored.ts")).toBe(true);
    expect(isExcludedPath("src/orders.ts")).toBe(false);
  });

  it("verifies exact SHA-pinned line ranges and rejects altered excerpts", async () => {
    const repository = new GitRepository(fixtureRoot);
    const metadata = await repository.metadata();
    const content = await repository.readFileAtCommit(metadata.commitSha, "src/orders.ts");
    const excerpt = content.split("\n").slice(0, 4).join("\n");

    await expect(
      repository.verifyExcerpt({
        commitSha: metadata.commitSha,
        path: "src/orders.ts",
        startLine: 1,
        endLine: 4,
        excerpt,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.verifyExcerpt({
        commitSha: metadata.commitSha,
        path: "src/orders.ts",
        startLine: 1,
        endLine: 4,
        excerpt: `${excerpt}\n// invented`,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.verifyExcerpt({
        commitSha: metadata.commitSha,
        path: "../outside.ts",
        startLine: 1,
        endLine: 1,
        excerpt: "nope",
      }),
    ).resolves.toBe(false);
  });

  it("says why an excerpt was rejected", async () => {
    const repository = new GitRepository(fixtureRoot);
    const metadata = await repository.metadata();
    const content = await repository.readFileAtCommit(metadata.commitSha, "src/orders.ts");
    const lines = content.split("\n");
    const base = { commitSha: metadata.commitSha, path: "src/orders.ts", startLine: 1, endLine: 2 };

    await expect(
      repository.checkExcerpt({ ...base, excerpt: lines.slice(0, 2).join("\n") }),
    ).resolves.toEqual({ ok: true });
    await expect(
      repository.checkExcerpt({ ...base, excerpt: `${lines[0]}\nchanged` }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/^Line 2 differs\./) });
    await expect(
      repository.checkExcerpt({ ...base, excerpt: lines.slice(0, 3).join("\n") }),
    ).resolves.toEqual({ ok: false, reason: "The excerpt has 3 lines but the range has 2." });
    await expect(
      repository.checkExcerpt({
        ...base,
        startLine: lines.length + 10,
        endLine: lines.length + 10,
        excerpt: "x",
      }),
    ).resolves.toEqual({ ok: false, reason: "The requested line range is outside the file." });
    await expect(
      repository.checkExcerpt({ ...base, path: "../outside.ts", excerpt: "x" }),
    ).resolves.toMatchObject({ ok: false, reason: expect.any(String) });
  });

  it("searches, reads, and verifies bounded excerpts in files above the full-read limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "spur-large-repository-"));
    try {
      const targetLine = 1_200;
      const lines = Array.from(
        { length: 1_800 },
        (_, index) => `export const filler${index} = "${"x".repeat(48)}";`,
      );
      lines[targetLine - 1] = "export const weekendCampaignOptimizationGuardrail = 0.2;";
      await writeFile(path.join(root, "organization.server.ts"), `${lines.join("\n")}\n`);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
      git("init", "-q");
      git("config", "user.name", "Spur Test");
      git("config", "user.email", "spur-test@example.invalid");
      git("add", "organization.server.ts");
      git("commit", "-q", "-m", "Add large source file");

      const repository = new GitRepository(root);
      const metadata = await repository.metadata();
      const entry = (await repository.listFilesAtCommit(metadata.commitSha)).find(
        (candidate) => candidate.path === "organization.server.ts",
      );
      expect(entry?.size).toBeGreaterThan(LIMITS.maxFileBytes);

      const match = (await repository.searchFilesAtCommit(
        metadata.commitSha,
        ["weekendCampaignOptimizationGuardrail"],
      ))[0];
      expect(match).toMatchObject({
        path: "organization.server.ts",
        matchedTerms: 1,
        lineNumbers: [targetLine],
      });

      const range = await repository.readLinesAtCommit(
        metadata.commitSha,
        "organization.server.ts",
        targetLine - 2,
        targetLine + 2,
      );
      expect(range.content).toContain("weekendCampaignOptimizationGuardrail");
      await expect(repository.verifyExcerpt({
        commitSha: metadata.commitSha,
        path: "organization.server.ts",
        startLine: range.startLine,
        endLine: range.endLine,
        excerpt: range.content,
      })).resolves.toBe(true);

      await expect(
        repository.readFileAtCommit(metadata.commitSha, "organization.server.ts"),
      ).rejects.toMatchObject({
        code: "file_exceeds_full_read_limit",
        message: expect.stringMatching(/exceeds the full-read limit/),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
