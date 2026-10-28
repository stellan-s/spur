import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import { updateKnowledgeGapInputSchema } from "@/core/knowledge-gap-types";
import { publicErrorMessage } from "@/core/public-error";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const { id } = await context.params;
    const input = updateKnowledgeGapInputSchema.parse(await request.json());
    return NextResponse.json(await service.updateKnowledgeGap(id, input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Knowledge gap could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await service?.close();
  }
}
