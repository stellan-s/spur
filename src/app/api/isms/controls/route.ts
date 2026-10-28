import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import { ismsControlInputSchema } from "@/core/isms-types";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
  return NextResponse.json({ error: publicErrorMessage(error, "ISMS controls unavailable.") }, { status });
}

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    return NextResponse.json({ controls: await service.listIsmsControls() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}

export async function POST(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = ismsControlInputSchema.parse(await request.json());
    return NextResponse.json({ control: await service.saveIsmsControl(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}
