import { z } from "zod";

const external = z.url({ protocol: /^https$/ });
export const studyAttachmentsSchema = z.object({
	items: z.array(z.object({
		kind: z.enum(["book", "reading", "video"]),
		title: z.string().min(1),
		part: z.string(),
		url: z.union([external, z.string().regex(/^\/ler\/[a-f0-9]{64}\?/)]),
		sectionUrl: external.optional(),
		suggested: z.boolean().optional(),
	})),
});
export type StudyAttachments = z.infer<typeof studyAttachmentsSchema>;
