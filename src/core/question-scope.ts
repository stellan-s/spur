// Spur explains evidence-backed organizational knowledge. It does not act as a
// general reviewer that assigns subjective quality judgments to software or teams.
export const BROAD_QUALITY_ASSESSMENT_MESSAGE =
  "Spur does not make broad quality judgments about an application, API, codebase, architecture, or team. Ask a specific, evidence-checkable question about behavior, rules, controls, dependencies, decisions, or recorded metrics instead.";

const assessmentVerb = /\b(?:assess|evaluate|rate|score|judge|review|audit|bed[oö]m(?:a)?|utv[aä]rdera|betygs[aä]tt|granska)\b/i;
const qualityDimension = /\b(?:quality|overall quality|good|bad|well[- ]built|reliab(?:le|ility)|maintainab(?:le|ility)|scalab(?:le|ility)|performan(?:t|ce)|robust(?:ness)?|kvalitet(?:en)?|bra|d[aå]lig|v[aä]lbyggd|tillf[oö]rlitlig(?:het)?|underh[aå]llbar(?:het)?|skalbar(?:het)?|prestanda|robust(?:het)?)\b/i;
const evaluativeForm = /\b(?:how (?:good|bad|reliable|maintainable|scalable|performant|robust)|hur (?:bra|d[aå]lig|v[aä]lbyggd|tillf[oö]rlitlig|underh[aå]llbar|skalbar|robust)|is .{0,40}(?:good|bad|reliable|maintainable|scalable|performant|robust)|[aä]r .{0,40}(?:bra|d[aå]lig|v[aä]lbyggd|tillf[oö]rlitlig|underh[aå]llbar|skalbar|robust))\b/i;
const broadTarget = /\b(?:app|application|api|codebase|code|system|product|architecture|implementation|software|frontend|backend|service|team|developer|vendor|appen|applikation(?:en)?|api(?:et|:t)?|koden|kodbas(?:en)?|system(?:et)?|produkt(?:en)?|arkitektur(?:en)?|implementation(?:en)?|mjukvar(?:a|an)|tj[aä]nst(?:en)?|team(?:et)?|utvecklar(?:en|na)?|leverant[oö]r(?:en)?)\b/i;

export function requestsBroadQualityAssessment(question: string): boolean {
  const normalized = question
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!broadTarget.test(normalized)) return false;
  return qualityDimension.test(normalized) &&
    (assessmentVerb.test(normalized) || evaluativeForm.test(normalized));
}
