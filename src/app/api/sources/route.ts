import { NextResponse } from "next/server";
import { z } from "zod";

import { registerSourceInputSchema } from "@/core/memory-types";
import { SpurError } from "@/core/errors";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export async function POST(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = registerSourceInputSchema.parse(await request.json());
    return NextResponse.json(await service.registerSource(input), { status: 201 });
  } catch (error) {
    const message = publicErrorMessage(error, "Source could not be registered.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message, code: error instanceof SpurError ? error.code : "source_write_failed" }, { status });
  } finally {
    await service?.close();
  }
}

export async function PATCH(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = patchSchema.parse(await request.json());
    return NextResponse.json(await service.setSourceEnabled(input.id, input.enabled));
  } catch (error) {
    const message = publicErrorMessage(error, "Source could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message, code: error instanceof SpurError ? error.code : "source_update_failed" }, { status });
  } finally {
    await service?.close();
  }
}

export async function DELETE(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = z.object({ id: z.string().trim().min(1).max(200) }).parse(await request.json());
    return NextResponse.json(await service.removeSource(input.id));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "The request body must be valid JSON."
      : publicErrorMessage(error, "Source could not be removed.");
    const status = error instanceof SpurError ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: message, code: error instanceof SpurError ? error.code : "source_remove_failed" }, { status });
  } finally {
    await service?.close();
  }
}
