import { SpurWorkspace } from "@/components/spur-workspace";
import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default function GuidePage() {
  if (tenancyMode() === "multi") redirect("/organizations");
  return <SpurWorkspace organizationSlug={defaultOrganizationSlug()} />;
}
