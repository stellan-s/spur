import { describe, expect, it } from "vitest";

import {
  MODELED_EVIDENCE_MAX_BYTES,
  MODELED_EVIDENCE_MAX_LINES,
  isDataFile,
  modeledEvidenceProblem,
} from "@/core/modeling-evidence-policy";
import { modeledEvidenceInputSchema } from "@/core/memory-types";

describe("modeled evidence policy", () => {
  it("accepts short source evidence and the verified-rules exception", () => {
    expect(modeledEvidenceProblem({
      path: "src/orders.ts",
      start_line: 10,
      end_line: 12,
      excerpt: "if (order.dispatched) {\n  throw new Error();\n}",
    })).toBeNull();
    expect(isDataFile("rules/verified-rules.json")).toBe(false);
  });

  it.each([
    "fixtures/orders.ts",
    "__snapshots__/orders.test.ts.snap",
    "tests/orders.snap",
    "data/customers.csv",
    "package-lock.json",
    "dist/index.js",
  ])("refuses noisy or sensitive modeling evidence from %s", (filePath) => {
    expect(modeledEvidenceProblem({
      path: filePath,
      start_line: 1,
      end_line: 1,
      excerpt: "example",
    })).toMatch(/cannot be stored/);
  });

  it("enforces compact line and byte limits in the MCP input schema", () => {
    const tooManyLines = modeledEvidenceInputSchema.safeParse({
      kind: "code",
      path: "src/orders.ts",
      start_line: 1,
      end_line: MODELED_EVIDENCE_MAX_LINES + 1,
      excerpt: Array.from({ length: MODELED_EVIDENCE_MAX_LINES + 1 }, () => "x").join("\n"),
    });
    expect(tooManyLines.success).toBe(false);

    const tooManyBytes = modeledEvidenceInputSchema.safeParse({
      kind: "code",
      path: "src/orders.ts",
      start_line: 1,
      end_line: 1,
      excerpt: "å".repeat(MODELED_EVIDENCE_MAX_BYTES),
    });
    expect(tooManyBytes.success).toBe(false);
  });
});
