import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService } from './health.service';

@Controller('v1')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('health')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.health.readiness();
    reply.status(result.ready ? 200 : 503);
    return result;
  }
}
