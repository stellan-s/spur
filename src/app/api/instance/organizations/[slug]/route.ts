import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import { instanceAdminContext } from "@/core/instance-admin";
import { organizationSlugSchema, updateOrganizationSchema } from "@/core/organization-settings";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { store, principal } = await instanceAdminContext(request);
    const slug = organizationSlugSchema.parse((await params).slug);
    const input = updateOrganizationSchema.parse(await request.json());
    return NextResponse.json({ organization: await store.update(principal.userId, slug, input) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "The organisation could not be updated.") }, {
      status: error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500,
    });
  }
}
