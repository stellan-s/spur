import { execFile, spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

import { LIMITS } from "./config";
import { RepositoryError } from "./errors";

const execFileAsync = promisify(execFile);

const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

const SECRET_NAMES = [
  /^\.env(?:\..+)?$/i,
  /(?:^|[-_.])(credential|credentials|secret|secrets)(?:[-_.]|$)/i,
  /(?:^|[-_.])(id_rsa|id_ed25519|private[-_.]?key)(?:[-_.]|$)/i,
  /\.(?:pem|p12|pfx|key)$/i,
];

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".prisma",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export function assertSafeRelativePath(relativePath: string): string {
  if (
    !relativePath ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.includes(":")
  ) {
    throw new RepositoryError("Repository path must be a safe relative path.", "unsafe_path");
  }

  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new RepositoryError("Repository path escapes the configured root.", "unsafe_path");
  }
  return normalized;
}

export function isExcludedPath(relativePath: string): boolean {
  let safePath: string;
  try {
    safePath = assertSafeRelativePath(relativePath);
  } catch {
    return true;
  }

  const segments = safePath.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment.toLowerCase()))) {
    return true;
  }

  const basename = segments.at(-1) ?? "";
  if (SECRET_NAMES.some((pattern) => pattern.test(basename))) return true;

  const extension = path.posix.extname(basename).toLowerCase();
  return extension !== "" && !TEXT_EXTENSIONS.has(extension);
}

export function isProbablyBinary(content: Buffer): boolean {
  const sample = content.subarray(0, Math.min(content.length, 8_000));
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;

  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.1;
}

export type TreeEntry = { path: string; size: number };

export type RepositorySearchMatch = {
  path: string;
  matchedTerms: number;
  lineNumbers: number[];
};

export type RepositoryLineRange = {
  startLine: number;
  endLine: number;
  content: string;
};

export type ExcerptCheckInput = {
  commitSha: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
};

export type ExcerptCheck = { ok: true } | { ok: false; reason: string };

const MAX_REPORTED_LINE_LENGTH = 120;

function clip(line: string): string {
  return line.length > MAX_REPORTED_LINE_LENGTH
    ? `${line.slice(0, MAX_REPORTED_LINE_LENGTH)}...`
    : line;
}

export class GitRepository {
  private canonicalRoot?: string;

  constructor(readonly root: string, private readonly displayName?: string) {}

  private async ensureRepository(): Promise<string> {
    if (this.canonicalRoot) return this.canonicalRoot;

    let info;
    try {
      info = await stat(this.root);
    } catch {
      throw new RepositoryError(
        `The configured repository does not exist: ${this.root}`,
        "repository_missing",
      );
    }
    if (!info.isDirectory()) {
      throw new RepositoryError("The configured repository root is not a directory.");
    }

    const canonical = await realpath(this.root);
    const topLevel = await this.git(["rev-parse", "--show-toplevel"], canonical);
    const canonicalTop = await realpath(topLevel.trim());
    if (canonicalTop !== canonical) {
      throw new RepositoryError(
        "SPUR_REPOSITORY_ROOT must point to the Git checkout root.",
        "repository_root_mismatch",
      );
    }
    this.canonicalRoot = canonical;
    return canonical;
  }

  private async git(
    args: string[],
    cwd?: string,
    allowNoMatches = false,
  ): Promise<string> {
    try {
      const result = await execFileAsync("git", args, {
        cwd: cwd ?? this.root,
        encoding: "utf8",
        maxBuffer: 2_000_000,
        timeout: LIMITS.gitTimeoutMs,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      return result.stdout;
    } catch (error) {
      if (
        allowNoMatches &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 1
      ) {
        return "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      }
      const detail = error instanceof Error ? error.message : "Unknown Git error";
      throw new RepositoryError(`Unable to read the configured Git repository: ${detail}`);
    }
  }

  async metadata(): Promise<{ name: string; commitSha: string; remoteUrl: string | null }> {
    const root = await this.ensureRepository();
    const commitSha = (await this.git(["rev-parse", "--verify", "HEAD^{commit}"], root)).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) {
      throw new RepositoryError("Git returned an invalid commit SHA.");
    }
    let remoteUrl: string | null = null;
    try {
      const candidate = (await this.git(["remote", "get-url", "origin"], root)).trim();
      if (candidate) remoteUrl = candidate;
    } catch {
      // A local repository without an origin remains a valid source.
    }
    return { name: this.displayName ?? path.basename(root), commitSha, remoteUrl };
  }

  async listFilesAtCommit(commitSha: string): Promise<TreeEntry[]> {
    const root = await this.ensureRepository();
    const output = await this.git(
      ["ls-tree", "-r", "-l", "-z", "--full-tree", commitSha],
      root,
    );

    const entries: TreeEntry[] = [];
    for (const record of output.split("\0")) {
      if (!record) continue;
      const match = record.match(/^\d+\s+blob\s+[a-f0-9]+\s+(\d+)\t(.+)$/s);
      if (!match) continue;
      const relativePath = assertSafeRelativePath(match[2]);
      const size = Number(match[1]);
      if (
        !Number.isSafeInteger(size) ||
        isExcludedPath(relativePath)
      ) {
        continue;
      }
      entries.push({ path: relativePath, size });
    }
    return entries;
  }

  async searchFilesAtCommit(
    commitSha: string,
    terms: string[],
  ): Promise<RepositorySearchMatch[]> {
    const root = await this.ensureRepository();
    const safeTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
      .slice(0, 12);
    const matches = new Map<
      string,
      { terms: Set<string>; lineScores: Map<number, number> }
    >();

    await Promise.all(
      safeTerms.map(async (term) => {
        const output = await this.git(
          ["grep", "-n", "-z", "-I", "-i", "-F", "-m", "20", "-e", term, commitSha, "--"],
          root,
          true,
        );
        const prefix = `${commitSha}:`;
        let cursor = 0;
        while (cursor < output.length) {
          const pathEnd = output.indexOf("\0", cursor);
          if (pathEnd < 0) break;
          const lineEnd = output.indexOf("\0", pathEnd + 1);
          if (lineEnd < 0) break;
          const recordEnd = output.indexOf("\n", lineEnd + 1);
          const item = output.slice(cursor, pathEnd);
          const lineNumber = Number(output.slice(pathEnd + 1, lineEnd));
          cursor = recordEnd < 0 ? output.length : recordEnd + 1;
          if (!item || !Number.isSafeInteger(lineNumber) || lineNumber < 1) continue;
          const candidate = item.startsWith(prefix) ? item.slice(prefix.length) : item;
          const relativePath = assertSafeRelativePath(candidate);
          if (isExcludedPath(relativePath)) continue;
          const match = matches.get(relativePath) ?? {
            terms: new Set<string>(),
            lineScores: new Map<number, number>(),
          };
          match.terms.add(term);
          match.lineScores.set(lineNumber, (match.lineScores.get(lineNumber) ?? 0) + 1);
          matches.set(relativePath, match);
        }
      }),
    );

    return [...matches.entries()]
      .map(([relativePath, match]) => ({
        path: relativePath,
        matchedTerms: match.terms.size,
        lineNumbers: [...match.lineScores.entries()]
          .sort((left, right) => right[1] - left[1] || left[0] - right[0])
          .map(([lineNumber]) => lineNumber),
      }))
      .sort(
        (left, right) =>
          right.matchedTerms - left.matchedTerms || left.path.localeCompare(right.path),
      );
  }

  async readFileAtCommit(commitSha: string, relativePath: string): Promise<string> {
    const root = await this.ensureRepository();
    const safePath = assertSafeRelativePath(relativePath);
    if (isExcludedPath(safePath)) {
      throw new RepositoryError("The requested file is excluded by repository policy.", "excluded_path");
    }

    const sizeOutput = await this.git(["cat-file", "-s", `${commitSha}:${safePath}`], root);
    const size = Number(sizeOutput.trim());
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RepositoryError("Git returned an invalid blob size.");
    }
    if (size > LIMITS.maxFileBytes) {
      throw new RepositoryError(
        `File exceeds the full-read limit of ${LIMITS.maxFileBytes} bytes. Use a bounded line range instead.`,
        "file_exceeds_full_read_limit",
      );
    }

    const output = await this.git(["show", `${commitSha}:${safePath}`], root);
    const bytes = Buffer.from(output, "utf8");
    if (isProbablyBinary(bytes)) {
      throw new RepositoryError("The requested file is binary.", "unsupported_file");
    }
    return output.replaceAll("\r\n", "\n");
  }

  async hasCommit(commitSha: string): Promise<boolean> {
    if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) return false;
    const root = await this.ensureRepository();
    try {
      await this.git(["cat-file", "-e", `${commitSha}^{commit}`], root);
      return true;
    } catch {
      return false;
    }
  }

  async readLinesAtCommit(
    commitSha: string,
    relativePath: string,
    startLine: number,
    endLine: number,
  ): Promise<RepositoryLineRange> {
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine - startLine + 1 > LIMITS.maxCandidateLines
    ) {
      throw new RepositoryError(
        `Line ranges must contain between 1 and ${LIMITS.maxCandidateLines} lines.`,
        "invalid_line_range",
      );
    }

    const root = await this.ensureRepository();
    const safePath = assertSafeRelativePath(relativePath);
    if (isExcludedPath(safePath)) {
      throw new RepositoryError("The requested file is excluded by repository policy.", "excluded_path");
    }

    return new Promise<RepositoryLineRange>((resolve, reject) => {
      const child = spawn("git", ["cat-file", "blob", `${commitSha}:${safePath}`], {
        cwd: root,
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const decoder = new StringDecoder("utf8");
      const selectedLines: string[] = [];
      const sampleChunks: Buffer[] = [];
      let sampleBytes = 0;
      let selectedBytes = 0;
      let currentLine = 1;
      let selectedLine = "";
      let stderr = "";
      let settled = false;
      let rangeComplete = false;

      const fail = (error: RepositoryError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(error);
      };

      const appendSelected = (value: string) => {
        if (currentLine < startLine || currentLine > endLine || value.length === 0) return;
        selectedBytes += Buffer.byteLength(value, "utf8");
        if (selectedBytes > LIMITS.maxExcerptBytes) {
          fail(new RepositoryError(
            `Selected line range exceeds the excerpt limit of ${LIMITS.maxExcerptBytes} bytes.`,
            "excerpt_too_large",
          ));
          return;
        }
        selectedLine += value;
      };

      const consume = (value: string) => {
        let cursor = 0;
        while (!settled) {
          const newline = value.indexOf("\n", cursor);
          if (newline < 0) {
            appendSelected(value.slice(cursor));
            return;
          }
          appendSelected(value.slice(cursor, newline));
          if (currentLine >= startLine && currentLine <= endLine) {
            selectedLines.push(selectedLine.endsWith("\r") ? selectedLine.slice(0, -1) : selectedLine);
            selectedLine = "";
          }
          currentLine += 1;
          cursor = newline + 1;
          if (currentLine > endLine) {
            rangeComplete = true;
            child.kill("SIGTERM");
            return;
          }
        }
      };

      const timer = setTimeout(() => {
        fail(new RepositoryError("Timed out while reading a repository line range."));
      }, LIMITS.gitTimeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        if (sampleBytes < 8_000) {
          const sample = chunk.subarray(0, 8_000 - sampleBytes);
          sampleChunks.push(sample);
          sampleBytes += sample.length;
        }
        consume(decoder.write(chunk));
      });
      child.stdout.on("end", () => {
        if (settled) return;
        consume(decoder.end());
        if (selectedLine.length > 0 && currentLine >= startLine && currentLine <= endLine) {
          selectedLines.push(selectedLine.endsWith("\r") ? selectedLine.slice(0, -1) : selectedLine);
          selectedLine = "";
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4_000) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        fail(new RepositoryError(`Unable to read the configured Git repository: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        clearTimeout(timer);
        if (code !== 0 && !rangeComplete) {
          settled = true;
          reject(new RepositoryError(
            `Unable to read the configured Git repository: ${stderr.trim() || `git exited with ${code}`}`,
          ));
          return;
        }
        if (isProbablyBinary(Buffer.concat(sampleChunks))) {
          settled = true;
          reject(new RepositoryError("The requested file is binary.", "unsupported_file"));
          return;
        }
        if (selectedLines.length === 0) {
          settled = true;
          reject(new RepositoryError("The requested line range is outside the file.", "line_range_out_of_bounds"));
          return;
        }
        settled = true;
        resolve({
          startLine,
          endLine: startLine + selectedLines.length - 1,
          content: selectedLines.join("\n"),
        });
      });
    });
  }

  async verifyExcerpt(input: ExcerptCheckInput): Promise<boolean> {
    return (await this.checkExcerpt(input)).ok;
  }

  /**
   * Like verifyExcerpt, but says why an excerpt was rejected: a read failure
   * (excluded path, binary file, range outside the file) is a different fix
   * from a text mismatch, and the caller cannot tell them apart from a boolean.
   */
  async checkExcerpt(input: ExcerptCheckInput): Promise<ExcerptCheck> {
    let range: RepositoryLineRange;
    try {
      range = await this.readLinesAtCommit(
        input.commitSha,
        input.path,
        input.startLine,
        input.endLine,
      );
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "The file could not be read.",
      };
    }

    if (range.endLine !== input.endLine) {
      return { ok: false, reason: `The file ends at line ${range.endLine}.` };
    }
    if (range.content === input.excerpt) return { ok: true };

    const actual = range.content.split("\n");
    const expected = input.excerpt.split("\n");
    if (actual.length !== expected.length) {
      return {
        ok: false,
        reason: `The excerpt has ${expected.length} lines but the range has ${actual.length}.`,
      };
    }
    const index = actual.findIndex((line, i) => line !== expected[i]);
    return {
      ok: false,
      reason: `Line ${input.startLine + index} differs. File: ${JSON.stringify(clip(actual[index]))}. Excerpt: ${JSON.stringify(clip(expected[index]))}.`,
    };
  }
}
