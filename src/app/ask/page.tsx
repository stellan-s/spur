import { redirect } from "next/navigation";
import { defaultOrganizationSlug, tenancyMode } from "@/core/config";

// Reads the organisation configuration, so it renders per request.
export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  if (tenancyMode() === "multi") redirect("/organizations");
  const params = await searchParams;
  const conversation = Array.isArray(params.conversation)
    ? params.conversation[0]
    : params.conversation;
  redirect(
    `/o/${defaultOrganizationSlug()}/ask${conversation ? `?conversation=${encodeURIComponent(conversation)}` : ""}`,
  );
}
