import { z } from "zod";

export const productDocumentInputSchema = z.object({
  document_type: z.enum(["prd", "spec"]),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(5).max(4_000).describe("Markdown. PRDs should cover problem, goals, scope, requirements, acceptance criteria and open questions. Specs should cover design, interfaces, data, failure handling, testing and rollout."),
  related_ids: z.array(z.string().startsWith("mem_")).max(30).default([]),
  sensitivity: z.literal("restricted").optional(),
});

export type ProductDocumentInput = z.infer<typeof productDocumentInputSchema>;
