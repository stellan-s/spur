type LogValue = string | number | boolean | null | undefined;

function safeFields(fields: Record<string, LogValue>): Record<string, Exclude<LogValue, undefined>> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, Exclude<LogValue, undefined>] =>
      entry[1] !== undefined,
    ),
  );
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, LogValue> = {},
  destination: "stdout" | "stderr" = level === "error" ? "stderr" : "stdout",
): void {
  const record = JSON.stringify({
    severity: level.toUpperCase(),
    event,
    timestamp: new Date().toISOString(),
    ...safeFields(fields),
  });
  if (destination === "stderr") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

export function logUnexpectedError(event: string, error: unknown): void {
  logEvent("error", event, {
    error_type: error instanceof Error ? error.name : typeof error,
    error_code: error && typeof error === "object" && "code" in error &&
      (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : undefined,
  });
}
