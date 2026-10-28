import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePrincipalPermission } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { manageMemoryInputSchema } from "@/core/memory-types";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, fallback: string) {
  const message = publicErrorMessage(error, fallback);
  const status = error instanceof SpurError
    ? error.status
    : error instanceof z.ZodError
      ? 400
      : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    const { id } = await context.params;
    return NextResponse.json({
      ...await service.getMemoryDetail(id),
      management: {
        edit: requestContext.principal.permissions.has("memory.edit"),
        promote: requestContext.principal.permissions.has("memory.promote"),
        archive: requestContext.principal.permissions.has("memory.archive"),
        merge: requestContext.principal.permissions.has("memory.merge"),
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "Memory object could not be loaded.");
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
    const input = manageMemoryInputSchema.parse(await request.json());
    if (input.action === "promote") {
      requirePrincipalPermission(requestContext.principal, "memory.promote");
      await service.promoteMemory(id);
    } else if (input.action === "archive") {
      requirePrincipalPermission(requestContext.principal, "memory.archive");
      await service.archiveMemory(id, input.confirmation);
    } else {
      requirePrincipalPermission(requestContext.principal, "memory.edit");
      await service.editMemory(id, input);
    }
    if (input.action === "archive") return new Response(null, { status: 204 });
    return NextResponse.json({
      ...await service.getMemoryDetail(id),
      management: {
        edit: requestContext.principal.permissions.has("memory.edit"),
        promote: requestContext.principal.permissions.has("memory.promote"),
        archive: requestContext.principal.permissions.has("memory.archive"),
        merge: requestContext.principal.permissions.has("memory.merge"),
      },
    });
  } catch (error) {
    return errorResponse(error, "Memory object could not be updated.");
  } finally {
    await service?.close();
  }
}
