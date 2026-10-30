import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePrincipalPermission } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { productDocumentInputSchema } from "@/core/product-document";
import { publicErrorMessage } from "@/core/public-error";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  let service: SpurService | undefined;
  try {
    const requestContext = await createAuthenticatedRequestContext(request);
    service = requestContext.service;
    requirePrincipalPermission(requestContext.principal, "memory.edit");
    const { id } = await context.params;
    const input = productDocumentInputSchema.parse(await request.json());
    return NextResponse.json(await service.saveProductDocument(input, id));
  } catch (error) {
    const message = publicErrorMessage(error, "Product document could not be updated.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await service?.close();
  }
}
