import { NextResponse } from "next/server";

import { LIMITS } from "@/core/config";
import { SpurError } from "@/core/errors";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    const context = await createAuthenticatedRequestContext(request);
    service = context.service;
    const { config } = context;
    const metadata = await service.repositoryStatus();
    return NextResponse.json(
      {
        ready: metadata.ready,
        repository: metadata.name,
        commit_sha: metadata.commit_sha,
        provider: config.synthesisProvider,
        synthesis_provider: config.synthesisProvider,
        limits: {
          max_question_characters: LIMITS.maxQuestionCharacters,
          max_files: LIMITS.maxFiles,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = publicErrorMessage(error, "Configuration unavailable.");
    const code = error instanceof SpurError ? error.code : "configuration_error";
    return NextResponse.json(
      { ready: false, error: message, code },
      { status: error instanceof SpurError ? error.status : 500 },
    );
  } finally {
    await service?.close();
  }
}
