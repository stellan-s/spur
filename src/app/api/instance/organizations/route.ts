import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import { instanceAdminContext } from "@/core/instance-admin";
import { createOrganizationSchema } from "@/core/organization-settings";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { store, principal } = await instanceAdminContext(request);
    return NextResponse.json({ organizations: await store.listManaged(principal.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Organisations could not be loaded.") }, {
      status: error instanceof SpurError ? error.status : 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    const { store, principal } = await instanceAdminContext(request);
    const input = createOrganizationSchema.parse(await request.json());
    return NextResponse.json({ organization: await store.create(principal.userId, input) }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "The organisation could not be created.") }, {
      status: error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500,
    });
  }
}
