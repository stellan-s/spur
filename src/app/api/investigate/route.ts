import { NextResponse } from "next/server";
import { z } from "zod";

import { LIMITS } from "@/core/config";
import { SpurError } from "@/core/errors";
import { logUnexpectedError } from "@/core/logger";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  question: z.string(),
  conversation_id: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > LIMITS.maxRequestBytes) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = requestSchema.parse(await request.json());
    return NextResponse.json(await service.investigate(input.question, input.conversation_id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SpurError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Body must contain a question string." }, { status: 400 });
    }
    logUnexpectedError("investigation_failed", error);
    return NextResponse.json({ error: "Investigation failed unexpectedly." }, { status: 500 });
  } finally {
    await service?.close();
  }
}
