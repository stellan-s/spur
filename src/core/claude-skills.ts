import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundledSkillsRoot = path.join(packageRoot, "skills");

const skillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

const skillManifestSchema = z.object({
  id: skillIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  compatible_spur: z.string().min(1),
  modeling_contract: z.string().min(1).optional(),
  skill_contract: z.string().min(1).optional(),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).refine(
  (manifest) => Boolean(manifest.modeling_contract || manifest.skill_contract),
  "A bundled skill manifest must declare a contract version.",
);

type SkillManifest = z.infer<typeof skillManifestSchema>;

export type ClaudeSkillStatus = {
  id: string;
  installed: boolean;
  target: string;
  bundled_version: string;
  installed_version: string | null;
  current: boolean;
  modified_files: string[];
};

function defaultClaudeSkillsRoot(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

function safeManifestFile(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (!normalized || normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`Skill manifest contains an unsafe file path: ${relativePath}`);
  }
  return normalized;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readManifest(filePath: string): Promise<SkillManifest> {
  return skillManifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function sameFiles(left: SkillManifest["files"], right: SkillManifest["files"]): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function bundledManifest(skillId: string): Promise<{ root: string; manifest: SkillManifest }> {
  skillIdSchema.parse(skillId);
  const root = path.join(bundledSkillsRoot, skillId);
  const manifest = await readManifest(path.join(root, "manifest.json"));
  if (manifest.id !== skillId) throw new Error(`Bundled skill ${skillId} has manifest id ${manifest.id}.`);
  for (const [relativePath, expected] of Object.entries(manifest.files)) {
    const safePath = safeManifestFile(relativePath);
    const actual = await sha256(path.join(root, safePath));
    if (actual !== expected) throw new Error(`Bundled skill checksum mismatch: ${safePath}.`);
  }
  return { root, manifest };
}

export async function getClaudeSkillStatus(
  skillId = "spur-model-repository",
  targetRoot = defaultClaudeSkillsRoot(),
): Promise<ClaudeSkillStatus> {
  const bundled = await bundledManifest(skillId);
  const target = path.join(targetRoot, skillId);
  const installedManifestPath = path.join(target, "manifest.json");
  if (!(await exists(target))) {
    return {
      id: skillId,
      installed: false,
      target,
      bundled_version: bundled.manifest.version,
      installed_version: null,
      current: false,
      modified_files: [],
    };
  }

  let installed: SkillManifest;
  try {
    installed = await readManifest(installedManifestPath);
  } catch {
    return {
      id: skillId,
      installed: true,
      target,
      bundled_version: bundled.manifest.version,
      installed_version: null,
      current: false,
      modified_files: ["manifest.json"],
    };
  }

  const modifiedFiles: string[] = [];
  for (const [relativePath, expected] of Object.entries(installed.files)) {
    const safePath = safeManifestFile(relativePath);
    const installedPath = path.join(target, safePath);
    if (!(await exists(installedPath)) || await sha256(installedPath) !== expected) {
      modifiedFiles.push(safePath);
    }
  }
  if (
    installed.id !== bundled.manifest.id ||
    (installed.version === bundled.manifest.version && !sameFiles(installed.files, bundled.manifest.files))
  ) {
    modifiedFiles.push("manifest.json");
  }

  return {
    id: skillId,
    installed: true,
    target,
    bundled_version: bundled.manifest.version,
    installed_version: installed.version,
    current: installed.version === bundled.manifest.version && modifiedFiles.length === 0,
    modified_files: [...new Set(modifiedFiles)].sort(),
  };
}

export async function installClaudeSkill(options: {
  skillId?: string;
  targetRoot?: string;
  force?: boolean;
} = {}): Promise<ClaudeSkillStatus & { event: "claude_skill_installed"; replaced: boolean }> {
  const skillId = options.skillId ?? "spur-model-repository";
  const targetRoot = options.targetRoot ?? defaultClaudeSkillsRoot();
  const bundled = await bundledManifest(skillId);
  const before = await getClaudeSkillStatus(skillId, targetRoot);
  if (before.modified_files.length > 0 && !options.force) {
    throw new Error(
      `Refusing to overwrite locally modified ${skillId} files: ${before.modified_files.join(", ")}. Re-run with --force to replace them.`,
    );
  }

  const target = path.join(targetRoot, skillId);
  await mkdir(target, { recursive: true });
  for (const relativePath of Object.keys(bundled.manifest.files)) {
    const safePath = safeManifestFile(relativePath);
    await mkdir(path.dirname(path.join(target, safePath)), { recursive: true });
    await copyFile(path.join(bundled.root, safePath), path.join(target, safePath));
  }
  await copyFile(path.join(bundled.root, "manifest.json"), path.join(target, "manifest.json"));

  const after = await getClaudeSkillStatus(skillId, targetRoot);
  return { event: "claude_skill_installed", replaced: before.installed, ...after };
}
