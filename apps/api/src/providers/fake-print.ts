import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomCrockford } from '../core/crypto';
import type { PrintJob, PrintPartner } from './ports';

/**
 * Drops the print file (PDF) and the job ticket (JSON with the shipping address) into a folder.
 * Locally the stand-in for the print partner (.local/print-outbox, shipping simulated from the dev
 * endpoints); in production the "manual" mode (PRINT_PARTNER=manual): staff print or upload the file
 * and mark the order shipped in the ops app. The folder holds addresses: never public, deleted with
 * the order data (90 days after delivery).
 */
export class FakePrintPartner implements PrintPartner {
  constructor(
    private readonly dir: string,
    private readonly prefix = 'DEV-PRINT',
  ) {}

  async submit(job: PrintJob): Promise<{ reference: string }> {
    const reference = `${this.prefix}-${randomCrockford(6)}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${reference}.pdf`), job.pdf);
    await writeFile(
      join(this.dir, `${reference}.json`),
      JSON.stringify(
        {
          orderId: job.orderId,
          product: job.product,
          quantity: job.quantity,
          address: job.address,
        },
        null,
        2,
      ),
    );
    return { reference };
  }
}
