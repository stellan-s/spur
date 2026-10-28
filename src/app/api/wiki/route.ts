import { NextResponse } from "next/server";

import { requirePrincipalPermission } from "@/core/auth";
import { SpurError } from "@/core/errors";
import { createAuthenticatedRequestContext } from "@/core/request-organization";
import type { SpurService } from "@/core/spur-service";
import { renderWikiArticleMarkdown, renderWikiMarkdown } from "@/core/wiki";
import { publicErrorMessage } from "@/core/public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let service: SpurService | undefined;
  try {
    const context = await createAuthenticatedRequestContext(request);
    service = context.service;
    const url = new URL(request.url);
    const markdown = url.searchParams.get("format") === "markdown";
    if (markdown) {
      requirePrincipalPermission(context.principal, "wiki.export");
    }
    const wiki = await service.wiki();
    if (markdown) {
      const articleId = url.searchParams.get("page");
      const content = articleId ? renderWikiArticleMarkdown(wiki, articleId) : renderWikiMarkdown(wiki);
      if (!content) {
        return NextResponse.json({ error: "The wiki page was not found." }, { status: 404 });
      }
      const filename = context.config.organization.slug.replace(/[^a-zA-Z0-9_-]/g, "-");
      return new Response(content, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${filename}-${articleId ? "page" : "wiki"}.md"`,
          "Content-Type": "text/markdown; charset=utf-8",
        },
      });
    }
    return NextResponse.json(wiki, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = publicErrorMessage(error, "The wiki could not be loaded.");
    return NextResponse.json({ error: message }, { status: error instanceof SpurError ? error.status : 500 });
  } finally {
    await service?.close();
  }
}
