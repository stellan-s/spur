import { AccessStore } from "@/core/access-store";
import { authenticateInstanceRequest, requireSameOrigin } from "@/core/auth";
import { tenancyMode } from "@/core/config";
import { AuthenticationError, InputError, SpurError } from "@/core/errors";
import { OrganizationStore } from "@/core/organization-store";
import {
  appendOAuthResult,
  authorizeMcpUser,
  htmlEscape,
  parseAuthorizationRequest,
  validateAuthorizationRequest,
} from "@/core/oauth";
import { publicErrorMessage } from "@/core/public-error";
import { publicRequestUrl, signInPath } from "@/core/public-url";
import { rateLimited } from "@/core/request-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hidden(name: string, value: string | undefined): string {
  return value === undefined ? "" : `<input type="hidden" name="${name}" value="${htmlEscape(value)}">`;
}

async function validated(request: Request, values: URLSearchParams) {
  const input = parseAuthorizationRequest(values);
  let authenticated;
  try {
    if (tenancyMode() === "multi" && !input.organization) {
      const { config, principal } = await authenticateInstanceRequest(request);
      const access = new AccessStore(config.databaseUrl);
      try {
        await validateAuthorizationRequest(input, publicRequestUrl(request), access);
        const organisations = await new OrganizationStore(config.databaseUrl).listForUser(principal.userId);
        const fields = [...values].filter(([name]) => name !== "organization" && name !== "decision").map(([name, value]) => hidden(name, value)).join("");
        const options = organisations.map((item) => `<option value="${htmlEscape(item.slug)}">${htmlEscape(item.name)}</option>`).join("");
        const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Choose an organisation</title></head><body><main><h1>Connect to Spur</h1><p>Choose one organisation for this connection. Its permissions and feature settings will apply.</p>${organisations.length ? `<form method="get" action="/oauth/authorize">${fields}<label>Organisation <select name="organization" required>${options}</select></label><button type="submit">Continue</button></form>` : `<p>You do not have approved organisation access. Ask an organisation administrator for access first.</p>`}</main></body></html>`;
        return { redirect: new Response(body, { headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        } }) } as const;
      } finally {
        await access.close();
      }
    }
    authenticated = await authorizeMcpUser(request, input.organization);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      const requestUrl = publicRequestUrl(request);
      const returnTo = `${requestUrl.pathname}?${values.toString()}`;
      const signIn = new URL(signInPath(input.organization ?? "", returnTo), requestUrl.origin);
      return { redirect: Response.redirect(signIn) } as const;
    }
    throw error;
  }
  const access = new AccessStore(authenticated.config.databaseUrl);
  try {
    await validateAuthorizationRequest(input, publicRequestUrl(request), access);
    const client = await access.getOAuthClient(input.clientId);
    return { input, authenticated, client: client!, access } as const;
  } catch (error) {
    await access.close();
    throw error;
  }
}

export async function GET(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  try {
    const result = await validated(request, publicRequestUrl(request).searchParams);
    if ("redirect" in result) return result.redirect!;
    await result.access.close();
    const input = result.input;
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ${htmlEscape(result.client.clientName)}</title><style>body{font:16px system-ui;max-width:38rem;margin:4rem auto;padding:0 1.25rem;color:#171717}button{font:inherit;padding:.65rem 1rem;border:1px solid #171717;border-radius:.35rem;background:#171717;color:white}.secondary{background:white;color:#171717;margin-left:.5rem}p{line-height:1.55;color:#525252}.box{border:1px solid #ddd;border-radius:.5rem;padding:1.25rem}</style></head><body><main><h1>Connect ${htmlEscape(result.client.clientName)}</h1><div class="box"><p>Organisation: <strong>${htmlEscape(result.authenticated.config.organization.name)}</strong></p><p>This client is asking to use Spur on your behalf. It will only receive the MCP tools allowed by your organisation permissions and feature settings.</p><p>Access will be sent to <strong>${htmlEscape(new URL(input.redirectUri).host)}</strong>. The client named itself; Spur has not verified that name. Allow only if you started this connection from that app.</p><form method="post">${hidden("response_type", input.responseType)}${hidden("client_id", input.clientId)}${hidden("redirect_uri", input.redirectUri)}${hidden("code_challenge", input.codeChallenge)}${hidden("code_challenge_method", input.codeChallengeMethod)}${hidden("scope", input.scope)}${hidden("state", input.state)}${hidden("resource", input.resource)}${hidden("organization", result.authenticated.config.organization.slug)}<button type="submit" name="decision" value="allow">Allow access</button><button class="secondary" type="submit" name="decision" value="deny">Deny</button></form></div></main></body></html>`;
    return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(input.redirectUri).origin}; base-uri 'none'; frame-ancestors 'none'` } });
  } catch (error) {
    const message = publicErrorMessage(error, "The OAuth request is invalid.");
    const status = error instanceof SpurError ? error.status : 500;
    return Response.json({ error: "invalid_request", error_description: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  let access: AccessStore | undefined;
  try {
    requireSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/x-www-form-urlencoded")) {
      return Response.json({ error: "invalid_request" }, { status: 415 });
    }
    const values = new URLSearchParams(await request.text());
    if (!["allow", "deny"].includes(values.get("decision") ?? "")) throw new InputError("Choose whether to allow access.");
    const result = await validated(request, values);
    if ("redirect" in result) return result.redirect!;
    access = result.access;
    if (values.get("decision") === "deny") {
      return Response.redirect(appendOAuthResult(result.input.redirectUri, {
        error: "access_denied",
        state: result.input.state,
      }));
    }
    const code = await access.saveOAuthAuthorizationCode({
      clientId: result.input.clientId,
      organizationId: result.authenticated.config.organization.slug,
      userId: result.authenticated.principal.userId,
      redirectUri: result.input.redirectUri,
      codeChallenge: result.input.codeChallenge,
      scope: result.input.scope,
      resource: result.input.resource,
    });
    return Response.redirect(appendOAuthResult(result.input.redirectUri, { code, state: result.input.state }));
  } catch (error) {
    const message = publicErrorMessage(error, "The OAuth request is invalid.");
    const status = error instanceof SpurError ? error.status : 500;
    return Response.json({ error: "invalid_request", error_description: message }, { status, headers: { "Cache-Control": "no-store" } });
  } finally {
    await access?.close();
  }
}
