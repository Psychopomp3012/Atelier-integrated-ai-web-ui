import { z } from 'zod';

export const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const AttachedFileSchema = z.object({
  name: z.string(),
  size: z.number().optional(),
  type: z.string().optional(),
  content: z.string().optional(),
  base64: z.string().optional(),
});

export type AttachedFileInput = z.infer<typeof AttachedFileSchema>;

export const PromptExecutionInputSchema = z.object({
  sessionId: z.string().optional(),
  sandboxId: z.string().optional(),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  selectedModel: z.string().min(1).default('auto'),
  model: z.string().optional(),
  messages: z.array(HistoryMessageSchema).optional(),
  files: z.array(AttachedFileSchema).optional(),
  environmentTarget: z.string().optional().default('cloud-sandbox-nv841'),
  apiKey: z.string().optional(),
});

export type PromptExecutionInput = z.infer<typeof PromptExecutionInputSchema>;

export const ModelListResponseSchema = z.array(
  z.object({
    id: z.string(),
    displayName: z.string(),
    description: z.string(),
    badge: z.string(),
    latencyEstimate: z.string(),
  })
);

export type ModelListResponse = z.infer<typeof ModelListResponseSchema>;
