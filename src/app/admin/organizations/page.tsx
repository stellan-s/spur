import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { OrganizationAdmin } from "@/components/organization-admin";
import { authenticateSessionToken, SESSION_COOKIE } from "@/core/auth";
import { loadInstanceConfig } from "@/core/config";
import { AuthenticationError, AuthorizationError } from "@/core/errors";
import { OrganizationStore } from "@/core/organization-store";
import { signInPath } from "@/core/public-url";

export const dynamic = "force-dynamic";

export default async function OrganizationAdminPage() {
  const config = loadInstanceConfig();
  if (config.tenancy !== "multi") notFound();
  const store = new OrganizationStore(config.databaseUrl, config.encryptionKey);
  let organisations;
  try {
    const principal = await authenticateSessionToken(config, (await cookies()).get(SESSION_COOKIE)?.value);
    organisations = await store.listManaged(principal.userId);
  } catch (error) {
    if (error instanceof AuthenticationError) redirect(signInPath("", "/admin/organizations"));
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return <OrganizationAdmin initialOrganizations={organisations} />;
}
