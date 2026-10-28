import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default async function ModelCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    kind?: string | string[];
  }>;
}) {
  if (tenancyMode() === "multi") redirect("/organizations");
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const kind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const target = new URLSearchParams();
  if (query) target.set("q", query);
  if (kind) target.set("kind", kind);
  redirect(`/o/${defaultOrganizationSlug()}/model/catalog${target.size ? `?${target}` : ""}`);
}
