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
});

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > LIMITS.maxRequestBytes) {
    return NextResponse.json(
      { error: "Request body is too large.", code: "request_too_large" },
      { status: 413 },
    );
  }

  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const body = requestSchema.parse(await request.json());
    const result = (await service.investigate(body.question)).analysis;
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SpurError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Body must be JSON with a question string.", code: "invalid_request" },
        { status: 400 },
      );
    }
    logUnexpectedError("analysis_failed", error);
    return NextResponse.json(
      { error: "Analysis failed unexpectedly.", code: "internal_error" },
      { status: 500 },
    );
  } finally {
    await service?.close();
  }
}
