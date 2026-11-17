import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PhotoRejectedError, processPhoto, sniffImageType } from './image';

/** A camera-like JPEG with GPS position, device and XMP data in its metadata. */
async function gpsTaggedJpeg(width = 2400, height = 1800) {
  return sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .jpeg({ quality: 90 })
    .withExif({
      IFD0: { Make: 'LeakyCam', Model: 'Model 9', Orientation: '1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '50/1 57/1 3000/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '6/1 57/1 1200/100',
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/>SecretXmpMarker</x:xmpmeta>')
    .toBuffer();
}

const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof PhotoRejectedError) return err.reason;
    throw err;
  }
  return null;
};

describe('alert photo processing (Phase 2)', () => {
  it('removes EXIF, GPS, XMP and device data', async () => {
    const input = await gpsTaggedJpeg();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(input.includes(Buffer.from('LeakyCam'))).toBe(true);
    expect(input.includes(Buffer.from('SecretXmpMarker'))).toBe(true);

    const out = await processPhoto(input);
    const after = await sharp(out.data).metadata();
    expect(after.format).toBe('jpeg');
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    for (const marker of ['LeakyCam', 'Model 9', 'SecretXmpMarker', 'Exif\0', 'http://ns.adobe']) {
      expect(out.data.includes(Buffer.from(marker)), marker).toBe(false);
    }
  });

  it('re-encodes to at most 1600 px on the long side', async () => {
    const out = await processPhoto(await gpsTaggedJpeg(3200, 1200));
    expect(Math.max(out.width, out.height)).toBe(1600);
    const small = await processPhoto(await gpsTaggedJpeg(800, 600));
    expect([small.width, small.height]).toEqual([800, 600]);
  });

  it('applies the EXIF orientation before dropping it', async () => {
    const rotated = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#000' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 }) // 90° clockwise, as phone cameras write it
      .toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);
    const out = await processPhoto(rotated);
    expect([out.width, out.height]).toEqual([200, 400]);
  });

  it('accepts WebP and outputs JPEG', async () => {
    const webp = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#0a0' },
    })
      .webp()
      .toBuffer();
    expect(sniffImageType(webp)).toBe('webp');
    const out = await processPhoto(webp);
    expect(sniffImageType(out.data)).toBe('jpeg');
  });

  it('checks magic bytes, never the file name or MIME type', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    expect(await rejection(processPhoto(png))).toBe('type');
    // A script or document renamed to foto.jpg.
    expect(await rejection(processPhoto(Buffer.from('<?php system($_GET["c"]); ?>')))).toBe('type');
    expect(await rejection(processPhoto(Buffer.from('%PDF-1.7\n1 0 obj')))).toBe('type');
    expect(
      await rejection(processPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))),
    ).toBe('type');
  });

  it('refuses files that only look like JPEG/WebP but do not decode', async () => {
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    expect(await rejection(processPhoto(fakeJpeg))).toBe('decode');
    const fakeWebp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(100, 1),
    ]);
    expect(await rejection(processPhoto(fakeWebp))).toBe('decode');
  });

  it('refuses images larger than 4000 × 4000 px', async () => {
    const big = await sharp({
      create: { width: 4001, height: 100, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    expect(await rejection(processPhoto(big))).toBe('dimensions');
  });

  it('refuses animated images', async () => {
    const frame = { width: 20, height: 20, channels: 3 as const, background: '#f00' };
    const animated = await sharp(
      [
        await sharp({ create: frame }).png().toBuffer(),
        await sharp({ create: { ...frame, background: '#00f' } })
          .png()
          .toBuffer(),
      ],
      { join: { animated: true } },
    )
      .webp({ loop: 0 })
      .toBuffer();
    expect(await rejection(processPhoto(animated))).toBe('animated');
  });
});
