import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getClaudeSkillStatus, installClaudeSkill } from "@/core/claude-skills";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "spur-claude-skills-"));
  temporaryRoots.push(root);
  return root;
}

describe("Claude skill installation", () => {
  it("installs the bundled skill and reports its version and integrity", async () => {
    const targetRoot = await temporaryRoot();
    const before = await getClaudeSkillStatus("spur-model-repository", targetRoot);
    expect(before.installed).toBe(false);

    const installed = await installClaudeSkill({ targetRoot });
    expect(installed).toMatchObject({
      event: "claude_skill_installed",
      installed: true,
      installed_version: "1.1.0",
      bundled_version: "1.1.0",
      current: true,
      replaced: false,
      modified_files: [],
    });
    expect(await readFile(path.join(installed.target, "SKILL.md"), "utf8"))
      .toContain("name: spur-model-repository");
  });

  it("protects local changes unless force is explicit", async () => {
    const targetRoot = await temporaryRoot();
    const installed = await installClaudeSkill({ targetRoot });
    const skillPath = path.join(installed.target, "SKILL.md");
    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\nlocal change\n`);

    expect((await getClaudeSkillStatus("spur-model-repository", targetRoot)).modified_files)
      .toEqual(["SKILL.md"]);
    await expect(installClaudeSkill({ targetRoot })).rejects.toThrow(/locally modified/);
    expect((await installClaudeSkill({ targetRoot, force: true })).current).toBe(true);
  });

  it("installs the bundled requirements skill by explicit ID", async () => {
    const targetRoot = await temporaryRoot();
    const installed = await installClaudeSkill({
      skillId: "spur-write-requirements",
      targetRoot,
    });

    expect(installed).toMatchObject({
      id: "spur-write-requirements",
      installed: true,
      installed_version: "1.2.0",
      bundled_version: "1.2.0",
      current: true,
      replaced: false,
      modified_files: [],
    });
    expect(await readFile(path.join(installed.target, "SKILL.md"), "utf8"))
      .toContain("name: spur-write-requirements");
  });

  it("rejects unsafe skill IDs before resolving bundled paths", async () => {
    await expect(getClaudeSkillStatus("../outside", await temporaryRoot())).rejects.toThrow();
  });
});
