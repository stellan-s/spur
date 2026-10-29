import { describe, expect, it } from "vitest";

import { isAuthenticatedSession, type WorkspaceSession } from "@/components/workspace-state";

function session(authMode: WorkspaceSession["auth_mode"]): WorkspaceSession {
  return {
    auth_mode: authMode,
    display_name: "Test User",
    email: "test@example.com",
  };
}

describe("workspace account menu", () => {
  it.each(["google", "otp"] as const)("treats %s sessions as authenticated", (authMode) => {
    expect(isAuthenticatedSession(session(authMode))).toBe(true);
  });

  it("keeps local mode unauthenticated", () => {
    expect(isAuthenticatedSession(session("none"))).toBe(false);
    expect(isAuthenticatedSession(undefined)).toBe(false);
  });
});
