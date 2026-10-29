import { z } from "zod";

export const productDocumentInputSchema = z.object({
  document_type: z.enum(["prd", "spec"]),
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(5).max(12_000).describe("Markdown. Select sections and visuals that fit the document. PRDs commonly cover problem, goals, scope, requirements and open questions, with optional acceptance criteria, Definition of Done, diagrams and images. Specs commonly cover design, interfaces, data, failure handling, testing and rollout."),
  related_ids: z.array(z.string().startsWith("mem_")).max(30).default([]),
  sensitivity: z.literal("restricted").optional(),
});

export type ProductDocumentInput = z.infer<typeof productDocumentInputSchema>;
