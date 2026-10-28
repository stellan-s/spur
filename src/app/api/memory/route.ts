import { NextResponse } from "next/server";
import { z } from "zod";

import { memoryKindSchema, recordDecisionInputSchema } from "@/core/memory-types";
import { SpurError } from "@/core/errors";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const kinds = url.searchParams
      .getAll("kind")
      .map((value) => memoryKindSchema.parse(value));
    return NextResponse.json({ items: await service.searchMemory(query, kinds) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Memory search failed.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    const code = error instanceof SpurError ? error.code : "memory_search_failed";
    return NextResponse.json({ error: message, code }, { status });
  } finally {
    await service?.close();
  }
}

export async function POST(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const input = recordDecisionInputSchema.parse(await request.json());
    return NextResponse.json(await service.recordDecision(input), { status: 201 });
  } catch (error) {
    const message = publicErrorMessage(error, "Decision could not be recorded.");
    const status = error instanceof SpurError ? error.status : error instanceof z.ZodError ? 400 : 500;
    const code = error instanceof SpurError ? error.code : "memory_write_failed";
    return NextResponse.json({ error: message, code }, { status });
  } finally {
    await service?.close();
  }
}
