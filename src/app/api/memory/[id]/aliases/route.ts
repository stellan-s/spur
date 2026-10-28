import { NextResponse } from "next/server";
import { z } from "zod";

import { SpurError } from "@/core/errors";
import {
  proposeMemoryAliasInputSchema,
  reviewMemoryAliasInputSchema,
} from "@/core/memory-types";
import { publicErrorMessage } from "@/core/public-error";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  const message = publicErrorMessage(error, "Alias could not be updated.");
  const status = error instanceof SpurError
    ? error.status
    : error instanceof z.ZodError
      ? 400
      : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    const { id } = await context.params;
    const body = z.object({ name: z.string() }).parse(await request.json());
    const input = proposeMemoryAliasInputSchema.parse({ memory_id: id, name: body.name });
    return NextResponse.json(await service.proposeMemoryAlias(input, "portal"), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}

export async function PATCH(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    const { id } = await context.params;
    const body = z.object({
      alias_id: z.string(),
      action: z.enum(["verify", "reject"]),
      note: z.string(),
      confirmation: z.string(),
    }).parse(await request.json());
    const input = reviewMemoryAliasInputSchema.parse({ memory_id: id, ...body });
    return NextResponse.json(await service.reviewMemoryAlias(input));
  } catch (error) {
    return errorResponse(error);
  } finally {
    await service?.close();
  }
}
