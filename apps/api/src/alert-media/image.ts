import sharp from 'sharp';

/** Limits for one alert photo (Phase 2, alert photos §2). */
export const PHOTO_LIMITS = {
  files: 2,
  /** The client sends < 300 KB; anything above 500 KB is refused while it is still being read. */
  fileBytes: 500 * 1024,
  /** Decoded size: larger images are refused before any resizing work. */
  maxInputSide: 4000,
  /** Long side after re-encoding. */
  maxOutputSide: 1600,
  jpegQuality: 80,
} as const;

export type PhotoRejection = 'type' | 'decode' | 'dimensions' | 'animated';

export class PhotoRejectedError extends Error {
  constructor(readonly reason: PhotoRejection) {
    super(`photo rejected: ${reason}`);
  }
}

export interface ProcessedPhoto {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * The client's MIME type is never trusted: only the first bytes decide. JPEG starts with FF D8 FF,
 * WebP with "RIFF" <size> "WEBP". Everything else (PNG, HEIC, SVG, PDF, a renamed script) is refused.
 */
export function sniffImageType(buf: Buffer): 'jpeg' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Decodes and re-encodes one photo: orientation applied (`rotate()`), at most 1600 px on the long side,
 * JPEG quality 80. `withMetadata()` is deliberately never called, so EXIF (GPS, device, time), XMP,
 * IPTC and ICC data are all dropped. Throws PhotoRejectedError for anything that is not a single,
 * decodable JPEG/WebP image of at most 4000 × 4000 px.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const kind = sniffImageType(input);
  if (!kind) throw new PhotoRejectedError('type');
  let meta: sharp.Metadata;
  try {
    // limitInputPixels guards against decompression bombs before the full decode.
    meta = await sharp(input, {
      animated: true,
      failOn: 'error',
      limitInputPixels: PHOTO_LIMITS.maxInputSide * PHOTO_LIMITS.maxInputSide,
    }).metadata();
  } catch {
    throw new PhotoRejectedError('decode');
  }
  if (meta.format !== kind) throw new PhotoRejectedError('type');
  if ((meta.pages ?? 1) > 1) throw new PhotoRejectedError('animated');
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new PhotoRejectedError('decode');
  if (width > PHOTO_LIMITS.maxInputSide || height > PHOTO_LIMITS.maxInputSide) {
    throw new PhotoRejectedError('dimensions');
  }
  try {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({
        width: PHOTO_LIMITS.maxOutputSide,
        height: PHOTO_LIMITS.maxOutputSide,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: PHOTO_LIMITS.jpegQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new PhotoRejectedError('decode');
  }
}
