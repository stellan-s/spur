import { readFile } from "node:fs/promises";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const scopedTables = [
  "sources",
  "evidence",
  "memory_objects",
  "relationships",
  "memory_merges",
  "knowledge_gaps",
  "investigations",
  "conversations",
  "conversation_turns",
  "source_analysis_runs",
  "source_analysis_run_objects",
  "source_analysis_run_relationships",
  "isms_controls",
  "isms_control_revisions",
];

describe("PostgreSQL organization scope", () => {
  it("includes organization_id in every store query that touches organization data", async () => {
    const file = new URL("../src/core/postgres-store.ts", import.meta.url);
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file.pathname, sourceText, ts.ScriptTarget.Latest, true);
    const unscoped: Array<{ line: number; sql: string }> = [];

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "query") {
        const argument = node.arguments[0];
        const sql = argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) ||
          ts.isTemplateExpression(argument)) ? argument.getText(source).toLowerCase() : "";
        if (scopedTables.some((table) => new RegExp(`\\b${table}\\b`).test(sql)) &&
            !sql.includes("organization_id")) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          unscoped.push({ line: line + 1, sql });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);

    expect(unscoped).toEqual([]);
  });

  it("cannot read or search another organization's rows", async () => {
    const { TestMemoryStore } = await import("./support/postgres");
    const first = new TestMemoryStore(":memory:", "scope-a");
    const second = new TestMemoryStore(":memory:", "scope-b");
    try {
      const item = await first.upsertMemory({
        kind: "rule",
        title: "Private rule",
        statement: "Only organization A can read this rule.",
        state: "accepted",
        authority: "person",
        confidence: 1,
      });
      expect(await first.getMemory(item.id)).not.toBeNull();
      expect(await second.getMemory(item.id)).toBeNull();
      expect(await second.searchMemory("organization rule")).toEqual([]);
      expect(await second.listAllMemory()).toEqual([]);
      expect(await second.listRelationships()).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
