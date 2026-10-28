import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import { mergeMemoryInputSchema } from "@/core/memory-types";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const { id } = await context.params;
    const input = mergeMemoryInputSchema.parse(await request.json());
    if (input.source_id !== id) {
      return NextResponse.json({ error: "Source ID does not match the URL." }, { status: 400 });
    }
    return NextResponse.json({ item: await service.mergeMemory(id, input.target_id, input.confirmation) });
  } catch (error) {
    const message = publicErrorMessage(error, "Catalog objects could not be merged.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await service?.close();
  }
}
