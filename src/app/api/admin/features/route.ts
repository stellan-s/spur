import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeApiRequest } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { FEATURE_NAMES, features, setFeature } from "@/core/features";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  feature: z.enum(FEATURE_NAMES),
  value: z.unknown(),
});

export async function GET(request: Request) {
  try {
    const { config } = await authorizeApiRequest(request);
    return NextResponse.json({ features: await features(config.organization.slug) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Features could not be loaded.");
    const status = error instanceof SpurError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { config, principal } = await authorizeApiRequest(request);
    const input = updateSchema.parse(await request.json());
    const updated = await setFeature(
      config.organization.slug,
      input.feature,
      input.value,
      principal.userId,
    );
    return NextResponse.json({ features: updated });
  } catch (error) {
    const message = publicErrorMessage(error, "The feature could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
