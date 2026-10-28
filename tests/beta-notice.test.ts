import { describe, expect, it } from "vitest";

import {
  appendBetaNotice,
  BETA_NOTICE_ENGLISH,
  BETA_NOTICE_SWEDISH,
  betaNoticeInstruction,
} from "@/core/beta-notice";

describe("answer beta notice", () => {
  it("appends the English notice as the final text", () => {
    expect(appendBetaNotice("The API rejects invalid input.", "How does validation work?"))
      .toBe(`The API rejects invalid input.\n\n${BETA_NOTICE_ENGLISH}`);
  });

  it("appends the Swedish notice to Swedish answers", () => {
    expect(appendBetaNotice("API:t avvisar ogiltiga värden.", "Hur fungerar valideringen?"))
      .toBe(`API:t avvisar ogiltiga värden.\n\n${BETA_NOTICE_SWEDISH}`);
  });

  it("does not duplicate an existing notice", () => {
    const answer = `An answer.\n\n${BETA_NOTICE_ENGLISH}`;
    expect(appendBetaNotice(answer, "What happens?")).toBe(answer);
  });

  it("gives MCP hosts an exact final-sentence instruction", () => {
    expect(betaNoticeInstruction("Vad händer?")).toContain(`exactly: "${BETA_NOTICE_SWEDISH}"`);
  });
});
