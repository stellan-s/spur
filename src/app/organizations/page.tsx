import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { authenticateSessionToken, SESSION_COOKIE } from "@/core/auth";
import { loadInstanceConfig } from "@/core/config";
import { AuthenticationError } from "@/core/errors";
import { OrganizationStore } from "@/core/organization-store";
import { signInPath } from "@/core/public-url";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const config = loadInstanceConfig();
  if (config.tenancy === "single") redirect(`/o/${config.organization.slug}/model`);
  let principal;
  try {
    principal = await authenticateSessionToken(config, (await cookies()).get(SESSION_COOKIE)?.value);
  } catch (error) {
    if (error instanceof AuthenticationError) redirect(signInPath("", "/organizations"));
    throw error;
  }
  const organisations = await new OrganizationStore(config.databaseUrl).listForUser(principal.userId);
  return (
    <main className="min-h-svh bg-background px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <Link href="/organizations" className="text-xl font-semibold tracking-tight">Spur</Link>
        <p className="text-sm text-muted-foreground">{principal.email}</p>
      </header>
      <section className="py-8" aria-labelledby="organisations-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 id="organisations-title" className="text-2xl font-semibold tracking-tight">Your organisations</h1>
            <p className="mt-2 text-sm text-muted-foreground">Choose the organisation you want to work in.</p>
          </div>
          {principal.instanceAdministrator ? <Button asChild variant="outline"><Link href="/admin/organizations">Manage organisations</Link></Button> : null}
        </div>
        <ul className="mt-8 divide-y border-y">
          {organisations.map((organisation) => (
            <li key={organisation.slug}>
              <Link href={`/o/${organisation.slug}/model`} className="flex items-center justify-between gap-4 rounded-sm px-3 py-5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span className="font-medium">{organisation.name}</span>
                <span className="text-sm text-muted-foreground">Open model →</span>
              </Link>
            </li>
          ))}
        </ul>
        {!organisations.length ? <p className="py-6 text-sm text-muted-foreground">You do not have access to any organisations yet. Ask an organisation administrator for a sign-in link.</p> : null}
      </section>
    </main>
  );
}
