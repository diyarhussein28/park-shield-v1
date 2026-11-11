import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      });
    }
    return parsed.data;
  }
}
