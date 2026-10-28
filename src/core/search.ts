import path from "node:path";

import { LIMITS } from "./config";
import { RepositoryError } from "./errors";
import { isDataFile } from "./modeling-evidence-policy";
import type { RepositoryLineRange } from "./repository";
import type { SourceProvider } from "./source-provider";
import type {
  CandidateKind,
  EvidenceCandidate,
  RepositorySnapshot,
} from "./types";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "alla",
  "also",
  "and",
  "are",
  "att",
  "before",
  "behöver",
  "can",
  "can't",
  "cannot",
  "customer",
  "customers",
  "den",
  "det",
  "does",
  "efter",
  "eller",
  "ett",
  "for",
  "från",
  "får",
  "har",
  "hur",
  "inte",
  "kan",
  "kund",
  "kunden",
  "med",
  "när",
  "och",
  "the",
  "this",
  "vad",
  "varför",
  "what",
  "when",
  "which",
  "why",
  "with",
]);

const SYNONYM_GROUPS = [
  ["address", "adress", "shipping", "delivery", "leverans"],
  ["change", "changed", "edit", "modify", "update", "ändra", "ändras"],
  ["dispatch", "dispatched", "ship", "shipped", "shipment", "skickad", "skickats"],
  ["discount", "discounts", "rabatt", "rabatter"],
  ["manager", "approval", "approve", "chef", "godkännande", "godkänna"],
  ["return", "returns", "refund", "retur", "returnera", "återbetalning"],
  ["days", "day", "dag", "dagar"],
  ["order", "orders", "beställning", "beställningar"],
  ["rationale", "reason", "intent", "policy", "anledning", "syfte", "regel"],
] as const;

function normalizedText(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stem(term: string): string {
  if (term.length > 6 && term.endsWith("ing")) return term.slice(0, -3);
  if (term.length > 5 && term.endsWith("ed")) return term.slice(0, -2);
  if (term.length > 5 && term.endsWith("es")) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith("s")) return term.slice(0, -1);
  return term;
}

export function queryKeywords(question: string): string[] {
  const raw = normalizedText(question).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(raw.filter((term) => !STOP_WORDS.has(term) && term.length >= 3))];
}

export function queryTerms(question: string): string[] {
  const base = new Set(
    queryKeywords(question).flatMap((term) => [term, stem(term)]),
  );

  for (const group of SYNONYM_GROUPS) {
    if (group.some((term) => base.has(normalizedText(term)))) {
      for (const term of group) base.add(normalizedText(term));
    }
  }
  return [...base].slice(0, 30);
}

function candidateKind(relativePath: string, content: string): CandidateKind {
  const lowerPath = relativePath.toLowerCase();
  if (/(^|\/)tests?\//.test(lowerPath) || /\.(?:test|spec)\.[^.]+$/.test(lowerPath)) {
    return "test";
  }
  if (
    lowerPath.endsWith("verified-rules.json") &&
    /"verified_by_role"\s*:\s*"[^"]+"/.test(content) &&
    /"verified_on"\s*:\s*"[^"]+"/.test(content)
  ) {
    return "verification_record";
  }
  if (
    [".md", ".txt", ".json", ".yaml", ".yml"].includes(
      path.posix.extname(lowerPath),
    ) &&
    /approval_status\s*[:=]\s*["']?approved["']?/i.test(content) &&
    /approved_(?:by|by_role|on)\s*[:=]/i.test(content)
  ) {
    return "approved_document";
  }
  if (
    /\.(?:c|cc|cs|go|java|js|jsx|kt|php|prisma|py|rb|rs|sql|swift|ts|tsx|vue)$/.test(
      lowerPath,
    )
  ) {
    return "code";
  }
  return "unapproved_context";
}

function scoreFile(relativePath: string, content: string, terms: string[]): number {
  const normalizedPath = normalizedText(relativePath.replace(/[\/_.-]+/g, " "));
  const normalizedContent = normalizedText(content);
  let score = 0;

  for (const term of terms) {
    if (normalizedPath.includes(term)) score += 8;
    let cursor = 0;
    let occurrences = 0;
    while ((cursor = normalizedContent.indexOf(term, cursor)) >= 0 && occurrences < 6) {
      occurrences += 1;
      cursor += term.length;
    }
    score += occurrences;
  }

  if (/(^|\/)src\//.test(relativePath)) score += 1;
  if (/(^|\/)tests?\//.test(relativePath)) score += 1;
  return score;
}

function scorePath(relativePath: string, terms: string[]): number {
  const normalizedPath = normalizedText(relativePath.replace(/[\/_.-]+/g, " "));
  return terms.reduce(
    (total, term) => total + (normalizedPath.includes(term) ? 1 : 0),
    0,
  );
}

function createExcerpt(
  content: string,
  terms: string[],
  kind: CandidateKind,
): { startLine: number; endLine: number; excerpt: string } {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();

  let startIndex = 0;
  if (kind !== "approved_document" && kind !== "verification_record") {
    let bestIndex = 0;
    let bestScore = -1;
    for (const [index, line] of lines.entries()) {
      const normalizedLine = normalizedText(line);
      const lineScore = terms.reduce(
        (total, term) => total + (normalizedLine.includes(term) ? 1 : 0),
        0,
      );
      if (lineScore > bestScore) {
        bestIndex = index;
        bestScore = lineScore;
      }
    }
    startIndex = Math.max(0, bestIndex - 12);
  }

  const endIndex = Math.min(lines.length, startIndex + LIMITS.maxCandidateLines);
  return {
    startLine: startIndex + 1,
    endLine: Math.max(startIndex + 1, endIndex),
    excerpt: lines.slice(startIndex, endIndex).join("\n"),
  };
}

async function readMatchingLineWindow(
  repository: SourceProvider,
  commitSha: string,
  relativePath: string,
  matchLine: number,
): Promise<RepositoryLineRange | null> {
  for (const lineCount of [LIMITS.maxCandidateLines, 9, 1]) {
    const linesBefore =
      lineCount === LIMITS.maxCandidateLines
        ? Math.min(12, lineCount - 1)
        : Math.floor((lineCount - 1) / 2);
    const startLine = Math.max(1, matchLine - linesBefore);

    try {
      return await repository.readLinesAtCommit(
        commitSha,
        relativePath,
        startLine,
        startLine + lineCount - 1,
      );
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "excerpt_too_large") {
        continue;
      }
      throw error;
    }
  }

  return null;
}

export async function retrieveEvidence(
  repository: SourceProvider,
  question: string,
): Promise<RepositorySnapshot> {
  const metadata = await repository.metadata();
  const terms = queryTerms(question);
  if (terms.length === 0) {
    return { ...metadata, repo: metadata.name, candidates: [], analyzedFiles: 0 };
  }
  const [allEntries, allMatches] = await Promise.all([
    repository.listFilesAtCommit(metadata.commitSha),
    repository.searchFilesAtCommit(metadata.commitSha, terms),
  ]);
  const availableEntries = allEntries.filter((entry) => !isDataFile(entry.path));
  const searchMatches = allMatches.filter((match) => !isDataFile(match.path));
  const matchedTermsByPath = new Map(
    searchMatches.map((match) => [match.path, match.matchedTerms]),
  );
  const searchMatchByPath = new Map(searchMatches.map((match) => [match.path, match]));
  const entries = [...availableEntries]
    .sort((left, right) => {
      const matchDifference =
        (matchedTermsByPath.get(right.path) ?? 0) -
        (matchedTermsByPath.get(left.path) ?? 0);
      if (matchDifference !== 0) return matchDifference;
      const pathDifference = scorePath(right.path, terms) - scorePath(left.path, terms);
      return pathDifference !== 0 ? pathDifference : left.path.localeCompare(right.path);
    })
    .slice(0, LIMITS.maxFiles);

  const documents: Array<{
    path: string;
    content: string;
    score: number;
    kind: CandidateKind;
    baseLine: number;
  }> = [];
  let consumedBytes = 0;
  let analyzedFiles = 0;

  for (let offset = 0; offset < entries.length; offset += 8) {
    const batch = entries.slice(offset, offset + 8).filter((entry) => {
      const match = searchMatchByPath.get(entry.path);
      if (entry.size > LIMITS.maxFileBytes && !match?.lineNumbers[0]) return false;
      const budgetedBytes = Math.min(entry.size, LIMITS.maxExcerptBytes);
      if (consumedBytes + budgetedBytes > LIMITS.maxRepositoryBytes) return false;
      consumedBytes += budgetedBytes;
      return true;
    });
    const contents = await Promise.all(
      batch.map(async (entry) => {
        try {
          const matchLine = searchMatchByPath.get(entry.path)?.lineNumbers[0];
          if (entry.size > LIMITS.maxFileBytes && matchLine) {
            const range = await readMatchingLineWindow(
              repository,
              metadata.commitSha,
              entry.path,
              matchLine,
            );
            if (!range) return null;
            return { entry, content: range.content, baseLine: range.startLine };
          }
          return {
            entry,
            content: await repository.readFileAtCommit(metadata.commitSha, entry.path),
            baseLine: 1,
          };
        } catch (error) {
          if (
            error instanceof RepositoryError &&
            (error.code === "unsupported_file" || error.code === "excluded_path")
          ) {
            return null;
          }
          throw error;
        }
      }),
    );
    for (const result of contents) {
      if (!result) continue;
      const { entry, content, baseLine } = result;
      analyzedFiles += 1;
      const score = scoreFile(entry.path, content, terms);
      if (score <= 0) continue;
      documents.push({
        path: entry.path,
        content,
        score,
        kind: candidateKind(entry.path, content),
        baseLine,
      });
    }
  }

  documents.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const selected = documents.slice(0, LIMITS.maxCandidates);
  const candidates: EvidenceCandidate[] = selected.map((document, index) => {
    const excerpt = createExcerpt(document.content, terms, document.kind);
    return {
      id: `E${index + 1}`,
      kind: document.kind,
      path: document.path,
      score: document.score,
      ...excerpt,
      startLine: excerpt.startLine + document.baseLine - 1,
      endLine: excerpt.endLine + document.baseLine - 1,
    };
  });

  return {
    repo: metadata.name,
    commitSha: metadata.commitSha,
    candidates,
    analyzedFiles,
  };
}
