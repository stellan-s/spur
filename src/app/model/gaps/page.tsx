import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default function ModelGapsPage() {
  if (tenancyMode() === "multi") redirect("/organizations");
  redirect(`/o/${defaultOrganizationSlug()}/model/gaps`);
}
