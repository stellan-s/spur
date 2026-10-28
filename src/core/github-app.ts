import { createSign } from "node:crypto";

import { RepositoryError } from "./errors";

export type GitHubTokenSource = () => Promise<string>;

type CachedToken = { token: string; expiresAt: number };

// Tokens are refreshed this long before GitHub's stated expiry.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

// Secret Manager keeps real newlines; a .env file may hold escaped ones.
export function normalisePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

/**
 * Mints short-lived installation tokens from a GitHub App's private key. Each
 * token is limited to one repository with read-only contents, and is cached
 * until shortly before it expires.
 */
export class GitHubAppAuth {
  private readonly tokens = new Map<string, CachedToken>();
  private readonly pending = new Map<string, Promise<CachedToken>>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly apiUrl = "https://api.github.com",
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  tokenSource(owner: string, repository: string): GitHubTokenSource {
    return () => this.token(owner, repository);
  }

  async token(owner: string, repository: string): Promise<string> {
    const key = `${owner}/${repository}`.toLowerCase();
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > this.now()) return cached.token;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.mint(owner, repository).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    const minted = await pending;
    this.tokens.set(key, minted);
    return minted.token;
  }

  private appJwt(): string {
    const issuedAt = Math.floor(this.now() / 1000) - 60;
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: this.appId }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${base64Url(signer.sign(this.privateKey))}`;
  }

  private async call(pathname: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(`${this.apiUrl.replace(/\/$/, "")}${pathname}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.appJwt()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "spur-source-provider",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RepositoryError("GitHub could not be reached to issue a repository token.", "github_unavailable");
    }
    if (!response.ok) {
      throw new RepositoryError(
        response.status === 404
          ? "The Spur GitHub App is not installed on this repository."
          : `GitHub refused to issue a repository token (${response.status}).`,
        "github_unavailable",
      );
    }
    return response.json();
  }

  private async mint(owner: string, repository: string): Promise<CachedToken> {
    const installation = await this.call(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/installation`,
    ) as { id?: number };
    if (typeof installation.id !== "number") {
      throw new RepositoryError("GitHub returned no installation for this repository.", "github_unavailable");
    }
    const issued = await this.call(`/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
      body: JSON.stringify({ repositories: [repository], permissions: { contents: "read", metadata: "read" } }),
    }) as { token?: string; expires_at?: string };
    const expiresAt = Date.parse(issued.expires_at ?? "");
    if (!issued.token || Number.isNaN(expiresAt)) {
      throw new RepositoryError("GitHub returned an unusable repository token.", "github_unavailable");
    }
    return { token: issued.token, expiresAt };
  }
}

let shared: { key: string; auth: GitHubAppAuth } | undefined;

function appAuth(env: NodeJS.ProcessEnv): GitHubAppAuth | undefined {
  const appId = env.SPUR_GITHUB_APP_ID?.trim();
  const privateKey = env.SPUR_GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) return undefined;
  const apiUrl = env.SPUR_GITHUB_API_URL?.trim() || "https://api.github.com";
  const key = `${appId}\n${apiUrl}\n${privateKey}`;
  if (shared?.key !== key) {
    shared = { key, auth: new GitHubAppAuth(appId, normalisePrivateKey(privateKey), apiUrl) };
  }
  return shared.auth;
}

export function githubAppConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return appAuth(env) !== undefined;
}

/**
 * A named token variable wins, for repositories outside the app. Otherwise the
 * GitHub App issues one. Undefined when neither is configured.
 */
export function githubTokenSource(
  owner: string,
  repository: string,
  credentialEnv?: string,
  env: NodeJS.ProcessEnv = process.env,
): GitHubTokenSource | undefined {
  const token = credentialEnv ? env[credentialEnv]?.trim() : undefined;
  if (token) return async () => token;
  return appAuth(env)?.tokenSource(owner, repository);
}
