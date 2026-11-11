import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { ZodPipe } from '../core/zod.pipe';
import { AckService, OWNER_REPLIES } from './ack.service';

const Token = z.object({ token: z.string().min(20).max(100) });
const Reply = Token.extend({ reply: z.enum(OWNER_REPLIES) });

/**
 * Owner replies (NT-02, NT-10). The token alone authenticates: links come from notifications and must
 * work on any device without signing in. Both endpoints are POST so the token never lands in a URL,
 * and opening a link (as mail scanners do) changes nothing; only the tap does.
 */
@Controller('v1/ack')
@SkipCsrf()
export class AckController {
  constructor(@Inject(AckService) private readonly ack: AckService) {}

  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.ack.preview(body.token);
  }

  @Post()
  @HttpCode(200)
  reply(@Body(new ZodPipe(Reply)) body: z.infer<typeof Reply>) {
    return this.ack.reply(body.token, body.reply);
  }
}
