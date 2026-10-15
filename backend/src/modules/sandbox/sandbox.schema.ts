import { z } from 'zod';

export const SandboxExecuteInputSchema = z.object({
  code: z.string().optional().default(''),
  language: z.string().optional().default('bash'),
  command: z.string().optional(),
  sessionId: z.string().optional(),
  entrypoint: z.string().optional(),
  sandboxId: z.string().optional(),
  timeoutMs: z.number().optional(),
});

export type SandboxExecuteInput = z.infer<typeof SandboxExecuteInputSchema>;
