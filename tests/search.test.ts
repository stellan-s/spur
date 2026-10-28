import { describe, expect, it } from "vitest";

import { RepositoryError } from "@/core/errors";
import { GitRepository } from "@/core/repository";
import { retrieveEvidence } from "@/core/search";

function repositoryWithReadError(error: Error): GitRepository {
  return {
    metadata: async () => ({
      name: "fixture",
      commitSha: "a".repeat(40),
      remoteUrl: null,
    }),
    listFilesAtCommit: async () => [
      { path: "src/unreadable.ts", size: 32 },
      { path: "src/discount-rule.ts", size: 96 },
    ],
    searchFilesAtCommit: async () => [
      { path: "src/discount-rule.ts", matchedTerms: 2, lineNumbers: [1] },
      { path: "src/unreadable.ts", matchedTerms: 1, lineNumbers: [1] },
    ],
    readFileAtCommit: async (_commitSha: string, relativePath: string) => {
      if (relativePath === "src/unreadable.ts") throw error;
      return "export const managerApprovalDiscount = 20;";
    },
  } as unknown as GitRepository;
}

describe("evidence retrieval", () => {
  it.each(["unsupported_file", "excluded_path"])(
    "skips a file rejected with %s and keeps investigating",
    async (code) => {
      const repository = repositoryWithReadError(
        new RepositoryError("Unreadable evidence file.", code),
      );

      const snapshot = await retrieveEvidence(
        repository,
        "When does a discount require manager approval?",
      );

      expect(snapshot.analyzedFiles).toBe(1);
      expect(snapshot.candidates).toHaveLength(1);
      expect(snapshot.candidates[0]?.path).toBe("src/discount-rule.ts");
    },
  );

  it("does not hide repository failures", async () => {
    const repository = repositoryWithReadError(
      new RepositoryError("Git failed.", "repository_error"),
    );

    await expect(retrieveEvidence(repository, "discount approval")).rejects.toMatchObject({
      code: "repository_error",
    });
  });

  it("prioritizes matching files beyond the repository read budget", async () => {
    const decoys = Array.from({ length: 400 }, (_, index) => ({
      path: `src/decoy-${String(index).padStart(3, "0")}.ts`,
      size: 3_000,
    }));
    const relevantPath = "src/project-budget-settings.ts";
    const repository = {
      metadata: async () => ({
        name: "fixture",
        commitSha: "a".repeat(40),
        remoteUrl: null,
      }),
      listFilesAtCommit: async () => [
        ...decoys,
        { path: relevantPath, size: 128 },
      ],
      searchFilesAtCommit: async () => [
        { path: relevantPath, matchedTerms: 3, lineNumbers: [1] },
      ],
      readFileAtCommit: async (_commitSha: string, relativePath: string) =>
        relativePath === relevantPath
          ? "A project budget must be a positive amount."
          : "export const unrelated = true;",
    } as unknown as GitRepository;

    const snapshot = await retrieveEvidence(
      repository,
      "What are the rules for setting a project budget?",
    );

    expect(snapshot.candidates[0]?.path).toBe(relevantPath);
  });

  it("retrieves a bounded line window instead of fully reading a large matching file", async () => {
    const relevantPath = "app/services/large-campaign-optimizer.ts";
    let fullReadCalled = false;
    const repository = {
      metadata: async () => ({
        name: "fixture",
        commitSha: "a".repeat(40),
        remoteUrl: null,
      }),
      listFilesAtCommit: async () => [
        { path: relevantPath, size: 80_000 },
      ],
      searchFilesAtCommit: async () => [
        { path: relevantPath, matchedTerms: 3, lineNumbers: [120] },
      ],
      readFileAtCommit: async () => {
        fullReadCalled = true;
        throw new Error("Large files must not be fully read.");
      },
      readLinesAtCommit: async (
        _commitSha: string,
        _relativePath: string,
        startLine: number,
      ) => ({
        startLine,
        endLine: startLine + 2,
        content: [
          "const ordinaryCampaign = true;",
          "const weekendCampaignOptimizationGuardrail = 0.2;",
          "export { weekendCampaignOptimizationGuardrail };",
        ].join("\n"),
      }),
    } as unknown as GitRepository;

    const snapshot = await retrieveEvidence(
      repository,
      "How does weekend campaign optimization guardrail work?",
    );

    expect(fullReadCalled).toBe(false);
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]).toMatchObject({
      path: relevantPath,
      startLine: 108,
      endLine: 110,
    });
    expect(snapshot.candidates[0]?.excerpt).toContain("weekendCampaignOptimizationGuardrail");
  });

  it("narrows the line window when a large-file excerpt exceeds the byte limit", async () => {
    const relevantPath = "app/services/wide-campaign-optimizer.ts";
    const requestedRanges: Array<[number, number]> = [];
    const repository = {
      metadata: async () => ({
        name: "fixture",
        commitSha: "a".repeat(40),
        remoteUrl: null,
      }),
      listFilesAtCommit: async () => [{ path: relevantPath, size: 90_000 }],
      searchFilesAtCommit: async () => [
        { path: relevantPath, matchedTerms: 3, lineNumbers: [120] },
      ],
      readLinesAtCommit: async (
        _commitSha: string,
        _relativePath: string,
        startLine: number,
        endLine: number,
      ) => {
        requestedRanges.push([startLine, endLine]);
        if (endLine - startLine + 1 === 40) {
          throw new RepositoryError("Excerpt is too large.", "excerpt_too_large");
        }
        return {
          startLine,
          endLine: startLine + 1,
          content: [
            "const weekendCampaignOptimizationGuardrail = 0.2;",
            "export { weekendCampaignOptimizationGuardrail };",
          ].join("\n"),
        };
      },
    } as unknown as GitRepository;

    const snapshot = await retrieveEvidence(
      repository,
      "How does weekend campaign optimization guardrail work?",
    );

    expect(requestedRanges).toEqual([
      [108, 147],
      [116, 124],
    ]);
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]).toMatchObject({
      path: relevantPath,
      startLine: 116,
      endLine: 117,
    });
  });

  it("skips a single oversized line and continues with other evidence", async () => {
    const oversizedPath = "app/generated/single-line-bundle.ts";
    const relevantPath = "app/services/campaign-budget.ts";
    const repository = {
      metadata: async () => ({
        name: "fixture",
        commitSha: "a".repeat(40),
        remoteUrl: null,
      }),
      listFilesAtCommit: async () => [
        { path: oversizedPath, size: 100_000 },
        { path: relevantPath, size: 80_000 },
      ],
      searchFilesAtCommit: async () => [
        { path: oversizedPath, matchedTerms: 4, lineNumbers: [1] },
        { path: relevantPath, matchedTerms: 3, lineNumbers: [30] },
      ],
      readLinesAtCommit: async (
        _commitSha: string,
        relativePath: string,
        startLine: number,
      ) => {
        if (relativePath === oversizedPath) {
          throw new RepositoryError("Excerpt is too large.", "excerpt_too_large");
        }
        return {
          startLine,
          endLine: startLine,
          content: "export const campaignBudgetChangeLimit = 0.2;",
        };
      },
    } as unknown as GitRepository;

    const snapshot = await retrieveEvidence(
      repository,
      "What is the campaign budget change limit?",
    );

    expect(snapshot.analyzedFiles).toBe(1);
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]?.path).toBe(relevantPath);
  });
});
