import type { FastifyInstance } from 'fastify';
import { sandboxController } from './sandbox.controller.js';

export async function sandboxRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sandbox/metrics', sandboxController.getMetrics.bind(sandboxController));
  app.get('/api/v1/sandbox/logs', sandboxController.getTerminalLogs.bind(sandboxController));
  app.get('/api/v1/sandbox/files', sandboxController.getFiles.bind(sandboxController));
  app.get('/api/v1/sandbox/file', sandboxController.getFileContent.bind(sandboxController));
  app.get('/api/v1/sandbox/usage', sandboxController.getUsage.bind(sandboxController));
  app.post('/api/v1/sandbox/execute', sandboxController.executeInSandbox.bind(sandboxController));
  app.post('/api/v1/sandbox/attach', sandboxController.attachSession.bind(sandboxController));
  app.post('/api/v1/sandbox/create', sandboxController.createSandbox.bind(sandboxController));
  app.post('/api/v1/sandbox/detach', sandboxController.detachSession.bind(sandboxController));
  app.delete('/api/v1/sandbox', sandboxController.deleteSandbox.bind(sandboxController));
}
