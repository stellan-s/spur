import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default async function ModelEntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (tenancyMode() === "multi") redirect("/organizations");
  const { id } = await params;
  redirect(`/o/${defaultOrganizationSlug()}/model/catalog/${encodeURIComponent(id)}`);
}
