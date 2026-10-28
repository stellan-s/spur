import { redirect } from "next/navigation";

import { OtpLoginForm } from "@/components/otp-login-form";
import { loadInstanceConfig, resolveOrganizationConfig, tenancyMode } from "@/core/config";
import { googleSignInPath, safeReturnPath } from "@/core/public-url";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function LoginPage({ searchParams }: Props) {
  const query = await searchParams;
  const organization = first(query.organization);
  const returnTo = safeReturnPath(first(query.return_to)) ?? "";
  const config = tenancyMode() === "multi" && !organization
    ? loadInstanceConfig()
    : await resolveOrganizationConfig(organization || undefined);
  const fallback = config.tenancy === "multi" && !organization
    ? "/organizations"
    : `/o/${config.organization.slug}/model`;
  if (config.authMode === "none") redirect(returnTo || fallback);
  if (config.authMode === "google") redirect(googleSignInPath(organization, returnTo || fallback));

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 p-6">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Spur</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in{config.organization.slug ? ` to ${config.organization.name}` : ""}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your email and we will send you a one-time login code.</p>
        <OtpLoginForm organization={organization} returnTo={returnTo || fallback} />
      </section>
    </main>
  );
}
