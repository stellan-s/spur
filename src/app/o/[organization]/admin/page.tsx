import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { SpurWorkspace } from "@/components/spur-workspace";
import { authenticateSessionToken, SESSION_COOKIE } from "@/core/auth";
import { resolveOrganizationConfig } from "@/core/config";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import { requirePermission } from "@/core/access-store";
import { signInPath } from "@/core/public-url";

type PageProps = { params: Promise<{ organization: string }> };

export default async function AdminPage({ params }: PageProps) {
  const { organization } = await params;
  let config;
  try {
    config = await resolveOrganizationConfig(organization);
  } catch {
    notFound();
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const principal = await authenticateSessionToken(config, token);
    requirePermission(principal, "users.manage");
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect(signInPath(organization, `/o/${organization}/admin`));
    }
    if (error instanceof AuthorizationError && error.code === "access_pending") redirect(`/access/pending?organization=${encodeURIComponent(organization)}`);
    notFound();
  }
  return <SpurWorkspace organizationSlug={organization} />;
}
