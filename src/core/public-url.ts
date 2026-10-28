import { ConfigurationError } from "./errors";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin users reach Spur on. Behind Cloud Run the server's own view of
 * the request can carry its bind address, so SPUR_PUBLIC_URL fixes it for
 * OAuth redirects, MCP resource ids and cookies.
 */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.SPUR_PUBLIC_URL?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("SPUR_PUBLIC_URL must be an absolute URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
    throw new ConfigurationError("SPUR_PUBLIC_URL must use HTTPS unless it is a loopback address.");
  }
  return url.origin;
}

/** The request URL as the user sees it: path and query kept, origin public. */
export function publicRequestUrl(request: Request, env: NodeJS.ProcessEnv = process.env): URL {
  const url = new URL(request.url);
  const origin = publicOrigin(env);
  if (!origin) return url;
  return new URL(`${url.pathname}${url.search}`, origin);
}

/**
 * A same-site path to return to after sign-in, or undefined. Rejects anything
 * a browser could resolve to another host, such as //host or /\host.
 */
export function safeReturnPath(value: string | null | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return undefined;
  }
  if (/[\u0000-\u001f\\]/.test(value)) return undefined;
  const resolved = new URL(value, "https://spur.invalid");
  if (resolved.origin !== "https://spur.invalid") return undefined;
  const path = `${resolved.pathname}${resolved.search}`;
  return path.startsWith("//") ? undefined : path;
}

export function googleSignInPath(organization: string, returnTo: string): string {
  const query = new URLSearchParams({ organization });
  const path = safeReturnPath(returnTo);
  if (path) query.set("return_to", path);
  return `/api/auth/google?${query.toString()}`;
}

/** The auth-mode-neutral entry point used by pages, invitations and OAuth. */
export function signInPath(organization: string, returnTo: string): string {
  const query = new URLSearchParams();
  if (organization) query.set("organization", organization);
  const path = safeReturnPath(returnTo);
  if (path) query.set("return_to", path);
  const serialized = query.toString();
  return serialized ? `/login?${serialized}` : "/login";
}
