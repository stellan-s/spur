export const MODELED_EVIDENCE_MAX_LINES = 20;
export const MODELED_EVIDENCE_MAX_BYTES = 4_096;

// Data dumps and generated artifacts are noisy evidence and can contain real
// customer data. Human-verified rules are the one JSON exception.
const DATA_FILE = /\.(json|jsonl|csv|tsv|lock|map|snap|svg|min\.js)$/i;
const DATA_DIRECTORY = /(^|\/)(debuggers?|fixtures?|__snapshots__|node_modules|dist|build)\//i;

export function isDataFile(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.toLowerCase().endsWith("verified-rules.json")) return false;
  return DATA_FILE.test(normalized) || DATA_DIRECTORY.test(normalized);
}

export function modeledEvidenceProblem(input: {
  path: string;
  start_line: number;
  end_line: number;
  excerpt: string;
}): string | null {
  const lineCount = input.end_line - input.start_line + 1;
  if (lineCount > MODELED_EVIDENCE_MAX_LINES) {
    return `Modeled evidence may contain at most ${MODELED_EVIDENCE_MAX_LINES} lines; cite the smallest exact range that supports the claim.`;
  }
  if (new TextEncoder().encode(input.excerpt).byteLength > MODELED_EVIDENCE_MAX_BYTES) {
    return `Modeled evidence may contain at most ${MODELED_EVIDENCE_MAX_BYTES} bytes; cite the smallest exact range that supports the claim.`;
  }
  if (isDataFile(input.path)) {
    const basename = input.path.replaceAll("\\", "/").split("/").at(-1) ?? input.path;
    return `${basename} is a data, fixture, snapshot, generated, or dependency file and cannot be stored as modeled evidence.`;
  }
  return null;
}
