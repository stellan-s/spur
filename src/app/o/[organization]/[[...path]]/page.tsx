import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { SpurWorkspace } from "@/components/spur-workspace";
import { requirePermission } from "@/core/access-store";
import { authenticateSessionToken, SESSION_COOKIE } from "@/core/auth";
import { defaultOrganizationSlug, resolveOrganizationConfig, tenancyMode } from "@/core/config";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import { features, requireFeature } from "@/core/features";
import { pageAccess, pageRouteFeatures } from "@/core/permissions";
import { signInPath } from "@/core/public-url";

type PageProps = {
  params: Promise<{ organization: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function serializeSearchParams(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function OrganizationWorkspacePage({ params, searchParams }: PageProps) {
  const { organization, path = [] } = await params;
  const query = await searchParams;
  const configuredDefault = tenancyMode() === "single" ? defaultOrganizationSlug() : organization;
  if (organization === "default" && configuredDefault !== "default") {
    const targetPath = path.length > 0 ? path.map(encodeURIComponent).join("/") : "model";
    redirect(`/o/${configuredDefault}/${targetPath}${serializeSearchParams(query)}`);
  }
  let config;
  try {
    config = await resolveOrganizationConfig(organization);
  } catch {
    notFound();
  }
  if (path.length === 0) redirect(`/o/${organization}/model${serializeSearchParams(query)}`);

  const route = path.join("/");
  if (route === "model/composition") redirect(`/o/${organization}/model/health`);
  if (route === "memory") redirect(`/o/${organization}/model/catalog?kind=decision`);
  const valid =
    ["ask", "model", "model/catalog", "model/health", "model/gaps", "documents", "sources", "isms/controls", "wiki", "guide"].includes(route) ||
    (path.length === 2 && path[0] === "wiki" && Boolean(path[1])) ||
    (path.length === 2 && path[0] === "documents" && Boolean(path[1])) ||
    (path.length === 3 && path[0] === "model" && path[1] === "catalog" && Boolean(path[2]));
  if (!valid) notFound();

  const pathname = `/o/${organization}/${route}`;
  const permission = pageAccess(pathname);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const principal = await authenticateSessionToken(config, token);
    if (permission !== "public" && permission !== "authenticated") {
      requirePermission(principal, permission);
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect(signInPath(organization, `${pathname}${serializeSearchParams(query)}`));
    }
    if (error instanceof AuthorizationError && error.code === "access_pending") redirect(`/access/pending?organization=${encodeURIComponent(organization)}`);
    notFound();
  }
  const featureSet = await features(organization);
  const disabledFeature = pageRouteFeatures(pathname)
    .find((feature) => {
      try {
        requireFeature(featureSet, feature);
        return false;
      } catch {
        return true;
      }
    });
  if (disabledFeature) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted/20 p-6">
        <section className="w-full max-w-lg rounded-xl border bg-card p-8 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">{config.organization.name}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Feature unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">This feature is turned off by your administrator.</p>
        </section>
      </main>
    );
  }

  return (
    <SpurWorkspace
      organizationSlug={organization}
      initialModelSelection={first(query.selected)}
      initialModelRelationship={first(query.relationship)}
      initialModelMap={first(query.map)}
      initialModelFocus={first(query.focus)}
      initialModelEntityId={path[0] === "model" && path[1] === "catalog" ? path[2] ?? "" : ""}
      initialCatalogQuery={first(query.q)}
      initialCatalogKind={first(query.kind) || "all"}
      initialProductDocumentId={path[0] === "documents" ? path[1] ?? "" : ""}
      initialProductDocumentType={first(query.type) || "all"}
      initialProductDocumentQuery={first(query.q)}
      initialConversationId={first(query.conversation)}
      initialIsmsSelection={first(query.selected)}
      initialWikiPageId={path[0] === "wiki" ? path[1] ?? "" : ""}
    />
  );
}
