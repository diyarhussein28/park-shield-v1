import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HealthService } from '../health/health.service';
import { OpsPublic } from './access';

@Controller('ops/v1')
export class OpsHealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('health')
  @OpsPublic()
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.health.readiness();
    reply.status(result.ready ? 200 : 503);
    return result;
  }
}
