import type { MemoryObject, MemoryRelationship } from "./memory-types";

export const WIKI_RELATED_KINDS = ["process", "rule", "control", "entity"] as const;
export type WikiRelatedKind = (typeof WIKI_RELATED_KINDS)[number];

export type WikiItem = Pick<
  MemoryObject,
  | "id"
  | "kind"
  | "title"
  | "statement"
  | "state"
  | "authority"
  | "confidence"
  | "subjects"
  | "evidence_ids"
  | "source_ids"
  | "source_version"
  | "created_at"
  | "updated_at"
  | "metadata"
>;

export type WikiLink = Pick<MemoryRelationship, "id" | "from_id" | "predicate" | "to_id">;

export type WikiCapability = {
  capability: WikiItem;
  processes: WikiItem[];
  rules: WikiItem[];
  controls: WikiItem[];
  entities: WikiItem[];
};

export type Wiki = {
  organization: { slug: string; name: string };
  generated_at: string;
  articles: WikiItem[];
  links: WikiLink[];
  capabilities: WikiCapability[];
  ungrouped: {
    processes: WikiItem[];
    rules: WikiItem[];
    controls: WikiItem[];
    entities: WikiItem[];
  };
};

export function wikiStateLabel(state: MemoryObject["state"]): string {
  if (state === "accepted") return "Confirmed";
  if (state === "candidate") return "Candidate";
  if (state === "disputed") return "Disputed";
  return "Stale";
}

function heading(value: string): string {
  return value.replace(/[\r\n#]+/g, " ").trim();
}

function markdownItems(title: string, items: WikiItem[], level = 3): string[] {
  if (items.length === 0) return [];
  const lines = [`${"#".repeat(level)} ${title}`, ""];
  for (const item of items) {
    lines.push(`- **${heading(item.title)}** — ${wikiStateLabel(item.state)}`);
    lines.push(`  ${item.statement.replace(/\r?\n/g, " ").trim()}`);
  }
  lines.push("");
  return lines;
}

export function renderWikiMarkdown(wiki: Wiki): string {
  const lines = [
    `# ${heading(wiki.organization.name)} wiki`,
    "",
    `Generated from live Spur memory at ${wiki.generated_at}.`,
    "",
  ];
  for (const section of wiki.capabilities) {
    lines.push(`## ${heading(section.capability.title)}`, "");
    lines.push(`**Status:** ${wikiStateLabel(section.capability.state)}`, "");
    lines.push(section.capability.statement, "");
    lines.push(...markdownItems("Processes", section.processes));
    lines.push(...markdownItems("Rules", section.rules));
    lines.push(...markdownItems("Controls", section.controls));
    lines.push(...markdownItems("Entities", section.entities));
  }
  const ungrouped = Object.values(wiki.ungrouped).flat();
  if (ungrouped.length > 0) {
    lines.push("## Other modelled knowledge", "");
    lines.push(...markdownItems("Processes", wiki.ungrouped.processes));
    lines.push(...markdownItems("Rules", wiki.ungrouped.rules));
    lines.push(...markdownItems("Controls", wiki.ungrouped.controls));
    lines.push(...markdownItems("Entities", wiki.ungrouped.entities));
  }
  return `${lines.join("\n").trim()}\n`;
}

function predicateLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function renderWikiArticleMarkdown(wiki: Wiki, articleId: string): string | null {
  const article = wiki.articles.find((candidate) => candidate.id === articleId);
  if (!article) return null;
  const articlesById = new Map(wiki.articles.map((candidate) => [candidate.id, candidate]));
  const connections = wiki.links.flatMap((link) => {
    if (link.from_id === article.id) {
      const related = articlesById.get(link.to_id);
      return related ? [{ related, label: predicateLabel(link.predicate), direction: "outgoing" }] : [];
    }
    if (link.to_id === article.id) {
      const related = articlesById.get(link.from_id);
      return related ? [{ related, label: predicateLabel(link.predicate), direction: "incoming" }] : [];
    }
    return [];
  });
  const lines = [
    `# ${heading(article.title)}`,
    "",
    `**Type:** ${heading(article.kind)}  `,
    `**Status:** ${wikiStateLabel(article.state)}  `,
    `**Confidence:** ${Math.round(article.confidence * 100)}%`,
    "",
    article.statement.trim(),
    "",
  ];
  if (article.subjects.length > 0) {
    lines.push("## Topics", "", article.subjects.map(heading).join(", "), "");
  }
  if (connections.length > 0) {
    lines.push("## Related pages", "");
    for (const connection of connections.sort((left, right) => left.related.title.localeCompare(right.related.title))) {
      const direction = connection.direction === "outgoing" ? "→" : "←";
      lines.push(`- ${direction} **${heading(connection.related.title)}** — ${heading(connection.label)}`);
    }
    lines.push("");
  }
  lines.push(
    "## Evidence",
    "",
    `${article.evidence_ids.length} evidence reference${article.evidence_ids.length === 1 ? "" : "s"}.`,
    "",
    `Generated from live Spur memory at ${wiki.generated_at}.`,
  );
  return `${lines.join("\n").trim()}\n`;
}
