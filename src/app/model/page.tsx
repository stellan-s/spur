import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{
    selected?: string | string[];
    relationship?: string | string[];
  }>;
}) {
  if (tenancyMode() === "multi") redirect("/organizations");
  const params = await searchParams;
  const selected = Array.isArray(params.selected) ? params.selected[0] : params.selected;
  const relationship = Array.isArray(params.relationship)
    ? params.relationship[0]
    : params.relationship;
  const query = new URLSearchParams();
  if (selected) query.set("selected", selected);
  if (relationship) query.set("relationship", relationship);
  redirect(`/o/${defaultOrganizationSlug()}/model${query.size ? `?${query}` : ""}`);
}
