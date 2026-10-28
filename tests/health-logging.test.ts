import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/healthz/route";
import { logUnexpectedError } from "@/core/logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("operational health and logging", () => {
  it("reports database readiness without exposing configuration", async () => {
    vi.stubEnv("DATABASE_URL", process.env.TEST_DATABASE_URL!);
    vi.stubEnv("SPUR_AUTH", "none");
    vi.stubEnv("SPUR_ORGANIZATION_SLUG", "default");

    const response = await GET(new Request("http://localhost/healthz"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", database: "ready" });
  });

  it("logs an error type and code but not its potentially sensitive message", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("secret database details"), { code: "E_TEST" });

    logUnexpectedError("operation_failed", error);

    expect(write).toHaveBeenCalledOnce();
    const record = JSON.parse(String(write.mock.calls[0][0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      severity: "ERROR",
      event: "operation_failed",
      error_type: "Error",
      error_code: "E_TEST",
    });
    expect(String(write.mock.calls[0][0])).not.toContain("secret database details");
  });
});
