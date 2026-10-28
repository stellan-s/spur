export const BETA_NOTICE_ENGLISH =
  "Spur and the model are in BETA. Double-check the answer against the original sources.";

export const BETA_NOTICE_SWEDISH =
  "Spur och modellen är i BETA. Dubbelkolla svaret mot originalkällorna.";

const swedishQuestion = /[åäö]|\b(?:vad|hur|varf[oö]r|vilk(?:a|en|et)|n[aä]r|kan|ska|[aä]r|och|p[aå]|finns|appen|svaret)\b/i;

export function betaNoticeFor(question: string): string {
  return swedishQuestion.test(question) ? BETA_NOTICE_SWEDISH : BETA_NOTICE_ENGLISH;
}

export function appendBetaNotice(answer: string, question: string): string {
  const trimmed = answer.trim();
  if (
    trimmed.endsWith(BETA_NOTICE_ENGLISH) ||
    trimmed.endsWith(BETA_NOTICE_SWEDISH)
  ) {
    return trimmed;
  }
  return `${trimmed}\n\n${betaNoticeFor(question)}`;
}

export function betaNoticeInstruction(question: string): string {
  return `End the final user-facing answer with exactly: "${betaNoticeFor(question)}"`;
}
