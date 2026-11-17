import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PHOTO_LIMITS } from './image';

/** Registration options for @fastify/multipart on the public API (scanner alerts only use it). */
export const MULTIPART_OPTIONS = {
  limits: {
    files: PHOTO_LIMITS.files,
    fileSize: PHOTO_LIMITS.fileBytes,
    fields: 4,
    fieldSize: 8 * 1024,
    parts: PHOTO_LIMITS.files + 4,
    headerPairs: 50,
  },
  throwFileSizeLimit: true,
} as const;

/**
 * A scanner alert as multipart/form-data: the field `alert` holds the same JSON as the plain JSON
 * request, and up to two files named `photos`. Files are only read into memory here (multer-style
 * memory storage, bounded by the limits above); nothing is decoded before the captcha is checked.
 */
export async function readAlertMultipart(
  req: FastifyRequest,
): Promise<{ body: unknown; photos: Buffer[] }> {
  let body: unknown;
  const photos: Buffer[] = [];
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'photos') {
          await part.toBuffer(); // drain
          continue;
        }
        photos.push(await part.toBuffer());
      } else if (part.fieldname === 'alert') {
        body = JSON.parse(String(part.value));
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (/FILE_TOO_LARGE|FILES_LIMIT|PARTS_LIMIT/.test(code)) {
      throw new PayloadTooLargeException({ error: 'photo_too_large' });
    }
    throw new BadRequestException({ error: 'invalid_request' });
  }
  return { body, photos };
}
