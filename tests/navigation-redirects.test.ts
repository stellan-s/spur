import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import OrganizationWorkspacePage from "@/app/o/[organization]/[[...path]]/page";
import AdminPage from "@/app/o/[organization]/admin/page";
import { GET as startSignIn } from "@/app/api/auth/google/route";
import { GET as finishSignIn } from "@/app/api/auth/google/callback/route";
import { SpurWorkspace } from "@/components/spur-workspace";
import { type Principal } from "@/core/access-store";
import { authenticateSessionToken } from "@/core/auth";
import { resolveOrganizationConfig, loadInstanceConfig, type SpurConfig } from "@/core/config";
import { AuthenticationError } from "@/core/errors";
import { features } from "@/core/features";
import { beginGoogleSignIn, finishGoogleSignIn } from "@/core/google-auth";
import { googleSignInPath, signInPath } from "@/core/public-url";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`Redirect: ${path}`); },
  notFound: () => { throw new Error("Not found"); },
}));
vi.mock("@/components/spur-workspace", () => ({ SpurWorkspace: () => null }));
vi.mock("@/core/config", () => ({
  defaultOrganizationSlug: () => "example",
  resolveOrganizationConfig: vi.fn(),
  loadInstanceConfig: vi.fn(),
  tenancyMode: () => "single",
}));
vi.mock("@/core/auth", () => ({
  SESSION_COOKIE: "spur_session",
  authenticateSessionToken: vi.fn(),
}));
vi.mock("@/core/features", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/core/features")>(),
  features: vi.fn(),
}));
vi.mock("@/core/google-auth", () => ({
  OIDC_STATE_COOKIE: "spur_oidc_state",
  beginGoogleSignIn: vi.fn(),
  finishGoogleSignIn: vi.fn(),
}));
vi.mock("@/core/request-limit", () => ({ rateLimited: () => undefined }));

let config: SpurConfig;
let principal: Principal;
let signInResult: Awaited<ReturnType<typeof finishGoogleSignIn>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPUR_PUBLIC_URL", "");
  config = { organization: { slug: "example", name: "Example" }, authMode: "google" } as SpurConfig;
  principal = {
    userId: "user-test",
    organizationId: "example",
    email: "reader@example.com",
    displayName: "Reader",
    accessStatus: "approved",
    permissions: new Set(["memory.read"]),
  };
  vi.mocked(resolveOrganizationConfig).mockResolvedValue(config);
  vi.mocked(loadInstanceConfig).mockReturnValue(config);
  vi.mocked(authenticateSessionToken).mockResolvedValue(principal);
  vi.mocked(features).mockResolvedValue({
    ask: false,
    code_search: "off",
    model_provider: "none",
    modelling_writes: false,
    isms: false,
    wiki: false,
    remote_mcp: false,
    knowledge_gaps: false,
  });
  signInResult = {
    token: "test-session",
    expiresAt: new Date(Date.now() + 60_000),
    accessStatus: "approved",
    organizationId: "example",
  };
  vi.mocked(finishGoogleSignIn).mockResolvedValue(signInResult);
});

afterEach(() => vi.unstubAllEnvs());

function page(path: string[] = [], query: Record<string, string | string[] | undefined> = {}, organization = "example") {
  return OrganizationWorkspacePage({
    params: Promise.resolve({ organization, path }),
    searchParams: Promise.resolve(query),
  });
}

describe("default landing page", () => {
  it("opens Model from the app root, organization root and default alias", async () => {
    expect(() => Home()).toThrow("Redirect: /o/example/model");
    await expect(page()).rejects.toThrow("Redirect: /o/example/model");
    await expect(page([], { map: "entities" }, "default"))
      .rejects.toThrow("Redirect: /o/example/model?map=entities");
  });

  it("loads Model with Ask disabled, no model provider and no Ask permission", async () => {
    const result = await page(["model"]);
    expect(result.type).toBe(SpurWorkspace);
    expect(result.props.organizationSlug).toBe("example");
  });

  it("still enforces model permissions and approval", async () => {
    principal.permissions.clear();
    await expect(page(["model"])).rejects.toThrow("Not found");
    principal.accessStatus = "pending";
    await expect(page(["model"])).rejects.toThrow("Redirect: /access/pending");
  });

  it("keeps the feature guard when Ask is requested explicitly", async () => {
    principal.permissions.add("memory.ask");
    const html = renderToStaticMarkup(await page(["ask"]));
    expect(html).toContain("Feature unavailable");
  });
});

describe("sign-in destinations", () => {
  it.each([
    { path: ["sources"], query: {} },
    { path: ["model", "catalog", "mem-test"], query: { kind: "entity", q: ["User account", "Project"], empty: undefined } },
  ])("keeps the original page and query: $path", async ({ path, query }) => {
    vi.mocked(authenticateSessionToken).mockRejectedValue(new AuthenticationError("Sign in"));
    let destination = "";
    try {
      await page(path, query);
    } catch (error) {
      destination = (error as Error).message.replace("Redirect: ", "");
    }
    const signIn = new URL(destination, "http://localhost:3003");
    expect(signIn.pathname).toBe("/login");
    expect(signIn.searchParams.get("organization")).toBe("example");
    const returnTo = new URL(signIn.searchParams.get("return_to")!, signIn.origin);
    expect(returnTo.pathname).toBe(`/o/example/${path.join("/")}`);
    expect(returnTo.searchParams.getAll("q")).toEqual(query.q ?? []);
    expect(returnTo.searchParams.has("empty")).toBe(false);
  });

  it("returns administrators to administration", async () => {
    vi.mocked(authenticateSessionToken).mockRejectedValue(new AuthenticationError("Sign in"));
    await expect(AdminPage({ params: Promise.resolve({ organization: "example" }) }))
      .rejects.toThrow(`Redirect: ${signInPath("example", "/o/example/admin")}`);
  });

  it("keeps the organisation when an administrator awaits approval", async () => {
    principal.accessStatus = "pending";
    await expect(AdminPage({ params: Promise.resolve({ organization: "example" }) }))
      .rejects.toThrow("Redirect: /access/pending?organization=example");
  });

  it("passes the safe destination into the Google sign-in transaction", async () => {
    vi.mocked(beginGoogleSignIn).mockResolvedValue({ url: new URL("https://accounts.google.com/"), state: "test-state" });
    const returnTo = "/o/example/model?map=entities&focus=mem-test";
    const response = await startSignIn(new Request(new URL(googleSignInPath("example", returnTo), "http://localhost:3003")));
    expect(response.status).toBe(307);
    expect(beginGoogleSignIn).toHaveBeenCalledWith(config, expect.any(URL), returnTo);
  });

  it.each([undefined, "/o/example/sources", "/oauth/authorize?client_id=test&state=original"])(
    "returns approved users to their destination, or Model by default: %s", async (returnTo) => {
      vi.mocked(finishGoogleSignIn).mockResolvedValue({ ...signInResult, returnTo });
      const response = await finishSignIn(new Request("http://localhost:3003/api/auth/google/callback"));
      expect(response.headers.get("location")).toBe(`http://localhost:3003${returnTo ?? "/o/example/model"}`);
      expect(response.headers.get("set-cookie")).toContain("spur_session=test-session;");
    },
  );

  it("keeps pending accounts on the approval page", async () => {
    vi.mocked(finishGoogleSignIn).mockResolvedValue({ ...signInResult, accessStatus: "pending", returnTo: "/o/example/sources" });
    const response = await finishSignIn(new Request("http://localhost:3003/api/auth/google/callback"));
    expect(response.headers.get("location")).toBe("http://localhost:3003/access/pending?organization=example");
  });

  it.each([undefined, "//other.example/", "https://other.example/", "/\\other.example/"])(
    "uses Model in local mode when a return path is absent or unsafe: %s", async (returnTo) => {
      config.authMode = "none";
      const url = new URL("http://localhost:3003/api/auth/google?organization=example");
      if (returnTo) url.searchParams.set("return_to", returnTo);
      const response = await startSignIn(new Request(url));
      expect(response.headers.get("location")).toBe("http://localhost:3003/o/example/model");
    },
  );

  it("keeps safe deep links in local mode too", async () => {
    config.authMode = "none";
    const returnTo = "/o/example/model/catalog?kind=rule&q=budget";
    const response = await startSignIn(new Request(new URL(googleSignInPath("example", returnTo), "http://localhost:3003")));
    expect(response.headers.get("location")).toBe(`http://localhost:3003${returnTo}`);
  });

  it("does not build sign-in links with external destinations", () => {
    const url = new URL(googleSignInPath("example", "//other.example/"), "http://localhost:3003");
    expect(url.searchParams.has("return_to")).toBe(false);
  });
});
