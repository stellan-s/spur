import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default function Home() {
  if (tenancyMode() === "multi") redirect("/organizations");
  const organization = defaultOrganizationSlug();
  redirect(`/o/${organization}/model`);
}
