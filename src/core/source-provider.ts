import { LIMITS, type SpurConfig } from "./config";
import { ConfigurationError, RepositoryError } from "./errors";
import { githubTokenSource, type GitHubTokenSource } from "./github-app";
import { UnconnectedSource } from "./unconnected-source";
import {
  GitRepository,
  assertSafeRelativePath,
  isExcludedPath,
  isProbablyBinary,
  type ExcerptCheck,
  type ExcerptCheckInput,
  type RepositoryLineRange,
  type RepositorySearchMatch,
  type TreeEntry,
} from "./repository";

export type SourceMetadata = { name: string; commitSha: string; remoteUrl: string | null };

export interface SourceProvider {
  readonly root: string;
  metadata(): Promise<SourceMetadata>;
  listFilesAtCommit(commitSha: string): Promise<TreeEntry[]>;
  searchFilesAtCommit(commitSha: string, terms: string[]): Promise<RepositorySearchMatch[]>;
  readFileAtCommit(commitSha: string, relativePath: string): Promise<string>;
  hasCommit(commitSha: string): Promise<boolean>;
  readLinesAtCommit(
    commitSha: string,
    relativePath: string,
    startLine: number,
    endLine: number,
  ): Promise<RepositoryLineRange>;
  verifyExcerpt(input: ExcerptCheckInput): Promise<boolean>;
  checkExcerpt(input: ExcerptCheckInput): Promise<ExcerptCheck>;
}

export class LocalGitSource extends GitRepository implements SourceProvider {}

export function sourceProviderFromConfig(config: SpurConfig): SourceProvider {
  const token = config.githubAppToken ?? githubTokenSource(config.githubOwner!, config.githubRepository!, "SPUR_GITHUB_APP_TOKEN", config.githubEnvironment);
  if (config.sourceProvider === "github" && !token) {
    throw new ConfigurationError("This organisation's GitHub credential is missing.", "missing_credentials");
  }
  return config.sourceProvider === "github"
    ? new GitHubSource(
      config.githubOwner!,
      config.githubRepository!,
      token!,
      config.githubApiUrl,
    )
    : config.repositoryRoot ? new LocalGitSource(config.repositoryRoot, config.repositoryName) : new UnconnectedSource();
}

type GitHubTreeResponse = {
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string; size?: number }>;
};

type GitHubContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  size?: number;
};

function clipped(line: string): string {
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

export class GitHubSource implements SourceProvider {
  readonly root: string;
  private cachedMetadata?: SourceMetadata;

  constructor(
    private readonly owner: string,
    private readonly repository: string,
    private readonly installationToken: string | GitHubTokenSource,
    private readonly apiUrl = "https://api.github.com",
    private readonly request: typeof fetch = fetch,
  ) {
    this.root = `github://${owner}/${repository}`;
  }

  private async github(pathname: string): Promise<unknown> {
    const token = typeof this.installationToken === "string"
      ? this.installationToken
      : await this.installationToken();
    let response: Response;
    try {
      response = await this.request(`${this.apiUrl.replace(/\/$/, "")}${pathname}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "spur-source-provider",
        },
        signal: AbortSignal.timeout(LIMITS.gitTimeoutMs),
      });
    } catch (error) {
      throw new RepositoryError(
        `GitHub could not be reached: ${error instanceof Error ? error.message : "network request failed"}.`,
        "github_unavailable",
      );
    }
    if (!response.ok) {
      throw new RepositoryError(
        response.status === 404
          ? "The GitHub repository, commit or file was not found."
          : `GitHub returned HTTP ${response.status}.`,
        response.status === 404 ? "github_not_found" : "github_api_error",
      );
    }
    return response.json();
  }

  private repositoryPath(suffix = ""): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}${suffix}`;
  }

  async metadata(): Promise<SourceMetadata> {
    if (this.cachedMetadata) return this.cachedMetadata;
    const repository = await this.github(this.repositoryPath()) as {
      full_name?: string;
      html_url?: string;
      default_branch?: string;
    };
    if (!repository.default_branch) throw new RepositoryError("GitHub did not return a default branch.");
    const commit = await this.github(this.repositoryPath(`/commits/${encodeURIComponent(repository.default_branch)}`)) as { sha?: string };
    if (!commit.sha || !/^[a-f0-9]{40,64}$/i.test(commit.sha)) {
      throw new RepositoryError("GitHub returned an invalid commit SHA.");
    }
    this.cachedMetadata = {
      name: repository.full_name ?? `${this.owner}/${this.repository}`,
      commitSha: commit.sha,
      remoteUrl: repository.html_url ?? `https://github.com/${this.owner}/${this.repository}`,
    };
    return this.cachedMetadata;
  }

  async listFilesAtCommit(commitSha: string): Promise<TreeEntry[]> {
    if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) throw new RepositoryError("Commit SHA is invalid.");
    const data = await this.github(this.repositoryPath(`/git/trees/${commitSha}?recursive=1`)) as GitHubTreeResponse;
    if (data.truncated) {
      throw new RepositoryError("The GitHub repository tree is too large to verify safely.", "repository_too_large");
    }
    return (data.tree ?? []).flatMap((entry) => {
      if (entry.type !== "blob" || typeof entry.path !== "string" || typeof entry.size !== "number") return [];
      const safePath = assertSafeRelativePath(entry.path);
      return isExcludedPath(safePath) ? [] : [{ path: safePath, size: entry.size }];
    });
  }

  private async readBlob(commitSha: string, relativePath: string): Promise<Buffer> {
    const safePath = assertSafeRelativePath(relativePath);
    if (isExcludedPath(safePath)) {
      throw new RepositoryError("The requested file is excluded by repository policy.", "excluded_path");
    }
    const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
    const data = await this.github(this.repositoryPath(`/contents/${encodedPath}?ref=${encodeURIComponent(commitSha)}`)) as GitHubContentResponse;
    if (data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
      throw new RepositoryError("GitHub did not return file content.", "unsupported_file");
    }
    const content = Buffer.from(data.content.replace(/\s/g, ""), "base64");
    if (isProbablyBinary(content)) throw new RepositoryError("The requested file is binary.", "unsupported_file");
    return content;
  }

  async readFileAtCommit(commitSha: string, relativePath: string): Promise<string> {
    const content = await this.readBlob(commitSha, relativePath);
    if (content.length > LIMITS.maxFileBytes) {
      throw new RepositoryError(
        `File exceeds the full-read limit of ${LIMITS.maxFileBytes} bytes. Use a bounded line range instead.`,
        "file_exceeds_full_read_limit",
      );
    }
    return content.toString("utf8").replaceAll("\r\n", "\n");
  }

  async searchFilesAtCommit(commitSha: string, terms: string[]): Promise<RepositorySearchMatch[]> {
    const safeTerms = [...new Set(terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean))].slice(0, 12);
    const entries = (await this.listFilesAtCommit(commitSha))
      .filter((entry) => entry.size <= LIMITS.maxFileBytes)
      .sort((left, right) => {
        const leftPath = left.path.toLocaleLowerCase();
        const rightPath = right.path.toLocaleLowerCase();
        const leftScore = safeTerms.filter((term) => leftPath.includes(term)).length;
        const rightScore = safeTerms.filter((term) => rightPath.includes(term)).length;
        return rightScore - leftScore || left.path.localeCompare(right.path);
      })
      .slice(0, LIMITS.maxFiles);
    const matches: RepositorySearchMatch[] = [];
    let consumedBytes = 0;
    for (let offset = 0; offset < entries.length && consumedBytes < LIMITS.maxRepositoryBytes; offset += 8) {
      const batch = entries.slice(offset, offset + 8).filter((entry) => {
        if (consumedBytes + entry.size > LIMITS.maxRepositoryBytes) return false;
        consumedBytes += entry.size;
        return true;
      });
      const contents = await Promise.all(batch.map(async (entry) => {
        try {
          return {
            entry,
            content: (await this.readBlob(commitSha, entry.path)).toString("utf8").replaceAll("\r\n", "\n"),
          };
        } catch (error) {
          if (error instanceof RepositoryError && ["unsupported_file", "excluded_path"].includes(error.code)) {
            return null;
          }
          throw error;
        }
      }));
      for (const item of contents) {
        if (!item) continue;
        const { entry, content } = item;
        const matched = new Set<string>();
        const lineNumbers: number[] = [];
        for (const [index, line] of content.split("\n").entries()) {
          const normalized = line.toLocaleLowerCase();
          const lineMatches = safeTerms.filter((term) => normalized.includes(term));
          if (lineMatches.length > 0 && lineNumbers.length < 20) lineNumbers.push(index + 1);
          for (const term of lineMatches) matched.add(term);
        }
        if (matched.size > 0) matches.push({ path: entry.path, matchedTerms: matched.size, lineNumbers });
      }
    }
    return matches.sort((left, right) => right.matchedTerms - left.matchedTerms || left.path.localeCompare(right.path));
  }

  async hasCommit(commitSha: string): Promise<boolean> {
    if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) return false;
    try {
      const result = await this.github(this.repositoryPath(`/commits/${commitSha}`)) as { sha?: string };
      return result.sha?.toLocaleLowerCase() === commitSha.toLocaleLowerCase();
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "github_not_found") return false;
      throw error;
    }
  }

  async readLinesAtCommit(
    commitSha: string,
    relativePath: string,
    startLine: number,
    endLine: number,
  ): Promise<RepositoryLineRange> {
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 ||
        endLine < startLine || endLine - startLine + 1 > LIMITS.maxCandidateLines) {
      throw new RepositoryError(
        `Line ranges must contain between 1 and ${LIMITS.maxCandidateLines} lines.`,
        "invalid_line_range",
      );
    }
    const content = (await this.readBlob(commitSha, relativePath)).toString("utf8").replaceAll("\r\n", "\n");
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const selected = lines.slice(startLine - 1, endLine);
    if (selected.length === 0) {
      throw new RepositoryError("The requested line range is outside the file.", "line_range_out_of_bounds");
    }
    const excerpt = selected.join("\n");
    if (Buffer.byteLength(excerpt) > LIMITS.maxExcerptBytes) {
      throw new RepositoryError(
        `Selected line range exceeds the excerpt limit of ${LIMITS.maxExcerptBytes} bytes.`,
        "excerpt_too_large",
      );
    }
    return { startLine, endLine: startLine + selected.length - 1, content: excerpt };
  }

  async verifyExcerpt(input: ExcerptCheckInput): Promise<boolean> {
    return (await this.checkExcerpt(input)).ok;
  }

  async checkExcerpt(input: ExcerptCheckInput): Promise<ExcerptCheck> {
    let range: RepositoryLineRange;
    try {
      range = await this.readLinesAtCommit(input.commitSha, input.path, input.startLine, input.endLine);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "The file could not be read." };
    }
    if (range.endLine !== input.endLine) return { ok: false, reason: `The file ends at line ${range.endLine}.` };
    if (range.content === input.excerpt) return { ok: true };
    const actual = range.content.split("\n");
    const expected = input.excerpt.split("\n");
    if (actual.length !== expected.length) {
      return { ok: false, reason: `The excerpt has ${expected.length} lines but the range has ${actual.length}.` };
    }
    const index = actual.findIndex((line, lineIndex) => line !== expected[lineIndex]);
    return {
      ok: false,
      reason: `Line ${input.startLine + index} differs. File: ${JSON.stringify(clipped(actual[index]))}. Excerpt: ${JSON.stringify(clipped(expected[index]))}.`,
    };
  }
}
