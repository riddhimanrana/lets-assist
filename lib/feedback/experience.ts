import { z } from "zod";

export const experienceFeedbackChangeSchema = z.union([
  z.object({ rating: z.number().int().min(1).max(5) }).strict(),
  z.object({ comment: z.string().trim().max(2000) }).strict(),
]);
