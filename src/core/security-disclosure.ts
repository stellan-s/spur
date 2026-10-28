import type { MemoryObject } from "./memory-types";
import type { EvidenceCandidate } from "./types";

// Best-effort answer suppression, not an authorization boundary. A connected
// model host may also have independent access to the repository or database.
export const SECURITY_WITHHELD_MESSAGE =
  "Spur does not disclose security findings through Ask or MCP. Use the organization's approved security review process.";

export const RESTRICTED_MESSAGE =
  "A security control exists here. Its details are restricted. Ask the security owner.";

export function restrictedMessage(securityContact?: string): string {
  return securityContact
    ? `A security control exists here. Its details are restricted. Ask ${securityContact}.`
    : RESTRICTED_MESSAGE;
}

export function isRestrictedMemory(item: Pick<MemoryObject, "metadata">): boolean {
  return item.metadata.sensitivity === "restricted";
}

// A restricted observation records a gap. Even its masked form tells a reader
// that a gap exists, so it is hidden rather than masked.
export function isRestrictedFinding(item: Pick<MemoryObject, "kind" | "metadata">): boolean {
  return isRestrictedMemory(item) && item.kind === "observation";
}

export function maskRestrictedMemory(item: MemoryObject, securityContact?: string): MemoryObject {
  if (!isRestrictedMemory(item)) return item;
  const label = item.kind === "control"
    ? "security control"
    : item.kind.replaceAll("_", " ");
  return {
    ...item,
    title: `Restricted ${label}`,
    statement: restrictedMessage(securityContact),
    subjects: [],
    evidence_ids: [],
    source_ids: [],
    source_version: null,
    actor: null,
    metadata: { sensitivity: "restricted" },
  };
}

const explicitIssue = /\b(?:vulnerabilit(?:y|ies)|security (?:issue|finding|gap|flaw|weakness|defect|hole|risk)|säkerhets(?:brist|sårbarhet|lucka|risk)|sårbarhet(?:er)?|attack surface|exploit(?:able)?|privilege escalation|cross[- ]tenant (?:access|leak)|unauthori[sz]ed access)\b/i;
const missingSafeguard = /\b(?:missing|absent|skips?|bypass(?:es)?|lacks?|without|fails? to|does not|is not|unchecked|unprotected|saknar|utan|kringgår|kontrollerar inte)\b/i;
const flawedSafeguard = /\b(?:trusts? .{0,80}(?:form|request|client)|catch(?:es)? every error|swallows? (?:all )?errors?|pass(?:es)? regardless|todo.{0,60}(?:check|permission))\b/i;
const safeguard = /\b(?:auth|authori[sz]ation|authentication|permissions?|access control|org(?:ani[sz]ation)? (?:check|access|id)|organi[sz]ation ?id|tenant (?:check|access|isolation)|role (?:check|permission)|credential|secret|token|session|encryption|behörighet|åtkomst|autentisering|auktorisering|lösenord|nyckel)\b/i;
const issueRequest = /\b(?:security issues?|security findings?|vulnerabilit(?:y|ies)|security gaps?|security weaknesses?|exploit(?:s|able)?|attack surface|bypass(?:es)?|säkerhetsbrist(?:er)?|säkerhetsluck(?:a|or)|sårbarhet(?:er)?|angreppsyta|kringgå(?:s|r)?)\b/i;

export function requestsSecurityIssues(question: string): boolean {
  const text = question.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return issueRequest.test(text) ||
    (missingSafeguard.test(text) && safeguard.test(text));
}

// Descriptive text states what the system does, such as a control that
// rejects requests without a valid signature. That reads like a missing
// safeguard to the heuristic, so only explicit issue wording blocks it.
export function containsSecurityIssue(
  text: string,
  options: { descriptive?: boolean } = {},
): boolean {
  const normalized = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  if (explicitIssue.test(normalized)) return true;
  if (options.descriptive) return false;
  return (missingSafeguard.test(normalized) || flawedSafeguard.test(normalized)) &&
    safeguard.test(normalized);
}

// Observations record gaps and defects; every other kind describes behaviour.
export function isDescriptiveKind(kind: string | undefined): boolean {
  return kind !== undefined && kind !== "observation";
}

export function isSecurityIssueMemory(
  item: Pick<MemoryObject, "title" | "statement" | "subjects" | "metadata"> & { kind?: string },
): boolean {
  if (item.metadata.security_issue === true || item.metadata.sensitivity === "security_issue") {
    return true;
  }
  if (isRestrictedMemory(item)) return false;
  return containsSecurityIssue([
    item.title,
    item.statement,
    ...item.subjects,
    JSON.stringify(item.metadata),
  ].join("\n"), { descriptive: isDescriptiveKind(item.kind) });
}

export function isSecurityIssueEvidence(candidate: Pick<EvidenceCandidate, "path" | "excerpt">): boolean {
  return containsSecurityIssue(`${candidate.path}\n${candidate.excerpt}`);
}
