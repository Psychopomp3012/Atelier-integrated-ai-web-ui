import { z } from 'zod';

export const HealthCheckResponseSchema = z.object({
  status: z.enum(['HEALTHY', 'DEGRADED', 'UNHEALTHY']),
  timestamp: z.string(),
  uptimeSec: z.number(),
  service: z.string(),
  version: z.string(),
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;
