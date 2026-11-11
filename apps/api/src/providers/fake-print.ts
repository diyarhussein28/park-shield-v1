import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomCrockford } from '../core/crypto';
import type { PrintJob, PrintPartner } from './ports';

/**
 * Local stand-in for the print partner: drops the print file and job ticket into .local/print-outbox
 * (git-ignored, contains the shipping address). Shipping is simulated from the dev endpoints.
 */
export class FakePrintPartner implements PrintPartner {
  constructor(private readonly dir: string) {}

  async submit(job: PrintJob): Promise<{ reference: string }> {
    const reference = `DEV-PRINT-${randomCrockford(6)}`;
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
