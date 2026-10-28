import { NextResponse } from "next/server";

import { SpurError } from "@/core/errors";
import { logUnexpectedError } from "@/core/logger";
import { createAuthenticatedRequestSpurService } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    service = await createAuthenticatedRequestSpurService(request);
    const id = new URL(request.url).searchParams.get("id")?.trim();
    return NextResponse.json(
      id ? await service.getConversation(id) : { conversations: await service.listConversations() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SpurError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    logUnexpectedError("conversation_read_failed", error);
    return NextResponse.json({ error: "Conversation could not be loaded." }, { status: 500 });
  } finally {
    await service?.close();
  }
}
