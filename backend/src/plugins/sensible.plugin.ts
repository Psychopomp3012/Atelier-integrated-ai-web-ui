import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

export async function registerSensiblePlugin(app: FastifyInstance): Promise<void> {
  await app.register(sensible);
}
