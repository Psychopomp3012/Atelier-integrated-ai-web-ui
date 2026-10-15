import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HealthCheckResponse } from './health.schema.js';
import { createSuccessResponse } from '../../utils/response.util.js';

export class HealthController {
  public async getHealth(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const payload: HealthCheckResponse = {
      status: 'HEALTHY',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      service: 'harness-agent-backend',
      version: '2.4.8-hybrid',
    };

    return reply.status(200).send(createSuccessResponse(payload));
  }
}

export const healthController = new HealthController();
