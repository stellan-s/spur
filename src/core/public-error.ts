import { z } from "zod";

import { SpurError } from "./errors";
import { logUnexpectedError } from "./logger";

/**
 * The message a route may show its caller. Spur and validation errors are
 * written for users; anything else, such as a database error, is logged and
 * replaced by the fallback so hosts and credentials never reach the client.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SpurError || error instanceof z.ZodError) return error.message;
  logUnexpectedError("route_failed", error);
  return fallback;
}
