import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function text(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("production packaging", () => {
  it("builds the standalone Next.js server and runs it without root privileges", async () => {
    const [dockerfile, nextConfig] = await Promise.all([
      text("Dockerfile"),
      text("next.config.ts"),
    ]);

    expect(nextConfig).toContain('output: "standalone"');
    expect(dockerfile).toContain("FROM base AS builder");
    expect(dockerfile).toContain("FROM base AS runner");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toMatch(/FROM base AS runner[\s\S]*USER node[\s\S]*CMD \["node", "server\.js"\]/);
  });

  it("defines a local PostgreSQL stack with a database readiness check", async () => {
    const compose = await text("docker-compose.yml");

    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("target: cli");
    expect(compose).toContain("/healthz");
    expect(compose).toContain('"127.0.0.1:3000:3000"');
  });

  it("defines EU Cloud Run and private recoverable Cloud SQL without applying it", async () => {
    const [main, variables] = await Promise.all([
      text("deploy/gcp/main.tf"),
      text("deploy/gcp/variables.tf"),
    ]);

    expect(variables).toContain('default     = "europe-north1"');
    expect(main).toContain('resource "google_cloud_run_v2_service" "spur"');
    expect(main).toContain('resource "google_cloud_run_v2_job" "migrate"');
    expect(main).toContain("readiness_probe");
    expect(main).toContain("ipv4_enabled    = false");
    expect(main).toContain("point_in_time_recovery_enabled = true");
    expect(main).toMatch(/role\s+= "roles\/compute\.networkUser"/);
    expect(main).not.toMatch(/local-exec|terraform\s+apply|gcloud\s+run/);
  });
});
