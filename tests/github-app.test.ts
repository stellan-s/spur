import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GitHubAppAuth, githubTokenSource, normalisePrivateKey } from "@/core/github-app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function fakeGitHub(expiresInMs: number, now: () => number) {
  const calls: Array<{ url: string; method: string; body?: unknown; jwt: string }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const jwt = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      jwt,
    });
    if (url.endsWith("/repos/acme/portal/installation")) return Response.json({ id: 42 });
    if (url.endsWith("/app/installations/42/access_tokens")) {
      return Response.json({
        token: `token-${calls.length}`,
        expires_at: new Date(now() + expiresInMs).toISOString(),
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, request };
}

describe("GitHub App tokens", () => {
  it("signs an app token and mints a read-only token for one repository", async () => {
    let clock = Date.parse("2026-10-21T08:00:00Z");
    const github = fakeGitHub(60 * 60 * 1000, () => clock);
    const auth = new GitHubAppAuth("123", privatePem, "https://api.github.test", github.request, () => clock);

    expect(await auth.token("acme", "portal")).toBe("token-2");
    expect(github.calls[1]).toMatchObject({
      method: "POST",
      body: { repositories: ["portal"], permissions: { contents: "read", metadata: "read" } },
    });
    const [header, payload, signature] = github.calls[0].jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "123" });

    clock += 30 * 60 * 1000;
    expect(await auth.token("acme", "portal")).toBe("token-2");
    expect(github.calls).toHaveLength(2);

    clock += 26 * 60 * 1000;
    expect(await auth.token("acme", "portal")).toBe("token-4");
  });

  it("explains a repository where the app is not installed", async () => {
    const github = fakeGitHub(60 * 60 * 1000, Date.now);
    const auth = new GitHubAppAuth("123", privatePem, "https://api.github.test", github.request);
    await expect(auth.token("acme", "other")).rejects.toThrow("not installed");
  });

  it("prefers a named token and falls back to the app", async () => {
    const env = {
      NODE_ENV: "test" as const, NAMED_TOKEN: "named", SPUR_GITHUB_APP_ID: "123", SPUR_GITHUB_APP_PRIVATE_KEY: privatePem,
    };
    expect(await githubTokenSource("acme", "portal", "NAMED_TOKEN", env)!()).toBe("named");
    expect(githubTokenSource("acme", "portal", "MISSING", env)).toBeTypeOf("function");
    expect(githubTokenSource("acme", "portal", undefined, { NODE_ENV: "test" })).toBeUndefined();
    expect(normalisePrivateKey("a\\nb")).toBe("a\nb");
  });
});
