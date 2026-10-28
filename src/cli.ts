#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { importSqlite } from "./core/sqlite-import";
import { runMigrations } from "./core/migrations";
import { AccessStore } from "./core/access-store";
import { getClaudeSkillStatus, installClaudeSkill } from "./core/claude-skills";
import { logEvent, logUnexpectedError } from "./core/logger";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  logEvent("error", "invalid_command", {
    usage: "spur <migrate|import-sqlite|serve|mcp|create-admin|skills> [options]",
  });
  process.exit(1);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;
  if (command === "skills") {
    const [action, platformOrOption] = rest;
    const target = option(rest, "--target");
    if (action === "install" && platformOrOption === "claude") {
      console.log(JSON.stringify(await installClaudeSkill({
        targetRoot: target,
        force: rest.includes("--force"),
      })));
      return;
    }
    if (action === "status" && (!platformOrOption || platformOrOption === "claude" || platformOrOption.startsWith("--"))) {
      console.log(JSON.stringify({
        event: "claude_skill_status",
        ...await getClaudeSkillStatus("spur-model-repository", target),
      }));
      return;
    }
    throw new Error(
      "Usage: spur skills install claude [--target <skills-directory>] [--force] | spur skills status [claude] [--target <skills-directory>]",
    );
  }
  if (command === "migrate") {
    const result = await runMigrations(requiredDatabaseUrl(), path.join(packageRoot, "migrations"));
    console.log(JSON.stringify({ event: "migrations_complete", ...result }));
    return;
  }
  if (command === "import-sqlite") {
    const sqlitePath = rest.find((value) => !value.startsWith("--"));
    const organization = option(rest, "--organization");
    if (!sqlitePath || !organization) {
      throw new Error("Usage: spur import-sqlite <path> --organization <slug>");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(organization)) {
      throw new Error("--organization must be a lowercase slug of letters, numbers, and hyphens.");
    }
    const result = await importSqlite({
      sqlitePath,
      organization,
      databaseUrl: requiredDatabaseUrl(),
      organizationName: option(rest, "--organization-name"),
    });
    console.log(JSON.stringify({ event: "sqlite_import_complete", ...result }));
    return;
  }
  if (command === "serve") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(packageRoot, "node_modules/next/dist/bin/next"), "start", ...rest], {
        env: process.env,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Next.js stopped with signal ${signal}.`));
        else if (code === 0) resolve();
        else reject(new Error(`Next.js stopped with exit code ${code ?? "unknown"}.`));
      });
    });
    return;
  }
  if (command === "mcp") {
    const { runStdioMcp } = await import("./mcp/server");
    await runStdioMcp();
    return;
  }
  if (command === "create-admin") {
    const email = option(rest, "--email");
    const organization = option(rest, "--organization") ??
      process.env.SPUR_ORGANIZATION_SLUG?.trim();
    if (!email || !organization) {
      throw new Error("Usage: spur create-admin --email <email> --organization <slug> [--name <name>]");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(organization)) {
      throw new Error("--organization must be a lowercase slug of letters, numbers, and hyphens.");
    }
    const access = new AccessStore(requiredDatabaseUrl());
    try {
      const principal = await access.provisionAdministrator({
        organizationId: organization,
        organizationName: option(rest, "--organization-name") ??
          process.env.SPUR_ORGANIZATION_NAME?.trim() ?? organization,
        email,
        displayName: option(rest, "--name"),
      });
      console.log(JSON.stringify({
        event: "administrator_provisioned",
        organization,
        user_id: principal.userId,
      }));
    } finally {
      await access.close();
    }
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  logUnexpectedError("command_failed", error);
  process.exitCode = 1;
});
