// Per-instance limits for unauthenticated endpoints, keyed by client address.
// They blunt floods that would open database connections or fill tables; a
// shared limit across instances needs Cloud Armor in front of the service.

type Bucket = "sign_in" | "oauth" | "oauth_register" | "health";

const LIMITS: Record<Bucket, { limit: number; windowMs: number }> = {
  sign_in: { limit: 30, windowMs: 60_000 },
  oauth: { limit: 60, windowMs: 60_000 },
  oauth_register: { limit: 10, windowMs: 60 * 60_000 },
  health: { limit: 120, windowMs: 60_000 },
};

const MAX_TRACKED = 10_000;
const windows = new Map<string, { count: number; resetAt: number }>();

// Google's front end appends the address it saw, so the last entry is the one
// a client cannot forge.
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? "local";
}

export function rateLimited(request: Request, bucket: Bucket, now = Date.now()): Response | undefined {
  const { limit, windowMs } = LIMITS[bucket];
  const key = `${bucket}:${clientAddress(request)}`;
  let entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    if (windows.size >= MAX_TRACKED) {
      for (const [candidate, value] of windows) if (value.resetAt <= now) windows.delete(candidate);
      if (windows.size >= MAX_TRACKED) windows.clear();
    }
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }
  entry.count += 1;
  if (entry.count <= limit) return undefined;
  return Response.json({ error: "Too many requests. Try again shortly." }, {
    status: 429,
    headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)), "Cache-Control": "no-store" },
  });
}

export function resetRequestLimits(): void {
  windows.clear();
}
