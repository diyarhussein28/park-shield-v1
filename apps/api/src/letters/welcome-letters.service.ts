import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createTranslator, type MessageKey } from '@parkshield/i18n';
import { PLAN_FEATURE_COUNTS } from '@parkshield/shared';
import { sql } from 'kysely';
import { BillingService } from '../billing/billing.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV } from '../core/tokens';
import type { WelcomeLetterStatus } from '../db/types.generated';
import {
  PAYMENTS,
  type Payments,
  type PostalAddress,
  type ShippingAddress,
} from '../providers/ports';
import { ProfileService } from '../profile/profile.service';
import { CompanyService } from './company.service';
import type { LetterSnapshot } from './letter';
import { renderLetterPdf, renderLettersPdf, type RenderInput } from './letter-pdf';

type Plan = LetterSnapshot['contract']['plan'];
const de = createTranslator('de');

/** Plan catalog lines, the same i18n keys the pricing page renders (landing.<plan>F1 … Fn). */
export function planBenefits(plan: Plan): string[] {
  return Array.from({ length: PLAN_FEATURE_COUNTS[plan] }, (_, i) =>
    de(`landing.${plan}F${i + 1}` as MessageKey),
  );
}

export const planName = (plan: Plan) => `ParkShield ${de(`landing.${plan}Name` as MessageKey)}`;

export const BATCH_MAX = 100;

export interface LetterRow {
  id: string;
  userId: string;
  version: number;
  status: WelcomeLetterStatus;
  plan: Plan;
  addressMissing: boolean;
  createdAt: Date;
  createdBy: string | null;
  createdByName: string | null;
  firstDownloadedAt: Date | null;
  sentAt: Date | null;
}

/**
 * Welcome letter (printed and posted): created once when the customer has paid and registered
 * the first vehicle, re-created as a new version by ops. The PDF is rendered on demand from the
 * frozen, encrypted snapshot and never stored.
 */
@Injectable()
export class WelcomeLettersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(CompanyService) private readonly company: CompanyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  /**
   * Outbox handler. Idempotent: at most one automatic letter per customer, ever, and only for
   * accounts that signed up with their address (`signup`); accounts that completed their profile
   * later get none (owner decision 2026-11-20; ops can still use „Neu erstellen“).
   */
  async check(userId: string): Promise<'created' | 'exists' | 'waiting' | 'skipped'> {
    if (await this.exists(userId)) return 'exists';
    const profile = await this.profiles.get(userId);
    if (profile?.source === 'completed_later') return 'skipped';
    if (!profile) return 'waiting';
    if (!(await this.ready(userId))) return 'waiting';
    const built = await this.build(userId);
    if (!built) return 'waiting';
    return (await this.insert(userId, built, null, true)) ? 'created' : 'exists';
  }

  /** "Neu erstellen": a new version from the current data (e.g. after a corrected address). */
  async recreate(userId: string, staffId: string): Promise<LetterRow> {
    const built = await this.build(userId);
    if (!built) throw new NotFoundException({ error: 'letter_not_possible' });
    const id = await this.insert(userId, built, staffId, false);
    return this.row(id!);
  }

  async listForCustomer(userId: string): Promise<LetterRow[]> {
    return this.base().where('l.user_id', '=', userId).orderBy('l.version', 'desc').execute();
  }

  /** Overview: newest first, with the customer number and the name from the snapshot. */
  async list(status: WelcomeLetterStatus | null, limit = 200) {
    let q = this.base()
      .innerJoin('users as c', 'c.id', 'l.user_id')
      .select(['c.customer_no as customerNo', 'l.snapshot_enc'])
      // Only the latest version of each customer's letter.
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('welcome_letters as n')
              .select('n.id')
              .whereRef('n.user_id', '=', 'l.user_id')
              .whereRef('n.version', '>', 'l.version'),
          ),
        ),
      )
      .orderBy('l.created_at', 'desc')
      .limit(limit);
    if (status) q = q.where('l.status', '=', status);
    const rows = await q.execute();
    return rows.map(({ snapshot_enc, ...r }) => ({
      ...r,
      name: this.decode(snapshot_enc).customer.name,
    }));
  }

  async customerNo(userId: string): Promise<string | null> {
    const u = await this.db
      .selectFrom('users')
      .select('customer_no')
      .where('id', '=', userId)
      .executeTakeFirst();
    return u?.customer_no ?? null;
  }

  async latestId(userId: string): Promise<string | null> {
    const r = await this.db
      .selectFrom('welcome_letters')
      .select('id')
      .where('user_id', '=', userId)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return r?.id ?? null;
  }

  /** The PDF of one letter. A download (not a preview) moves NEU to HERUNTERGELADEN. */
  async pdf(
    letterId: string,
    opts: { download: boolean },
  ): Promise<{ file: Buffer; row: LetterRow }> {
    const row = await this.row(letterId);
    const file = await renderLetterPdf(await this.renderInput(letterId));
    if (opts.download) await this.markDownloaded([letterId]);
    return { file, row };
  }

  /** Several letters in one PDF for printing, in the given order. */
  async batchPdf(ids: string[]): Promise<{ file: Buffer; rows: LetterRow[] }> {
    const rows = await this.base().where('l.id', 'in', ids).execute();
    if (rows.length !== new Set(ids).size)
      throw new NotFoundException({ error: 'letter_not_found' });
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const inputs: RenderInput[] = [];
    for (const r of rows) inputs.push(await this.renderInput(r.id));
    const file = await renderLettersPdf(inputs);
    await this.markDownloaded(ids);
    return { file, rows };
  }

  async markSent(ids: string[]): Promise<number> {
    const r = await this.db
      .updateTable('welcome_letters')
      .set({ status: 'sent', sent_at: sql`now()` })
      .where('id', 'in', ids)
      .where('status', '<>', 'sent')
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  /** Customer portal ("Dokumente"), only while welcome_letter.in_portal is on. */
  async portalPdf(userId: string): Promise<Buffer> {
    if (!(await this.settings.get('welcome_letter.in_portal', false)))
      throw new NotFoundException();
    const id = await this.latestId(userId);
    if (!id) throw new NotFoundException();
    return renderLetterPdf(await this.renderInput(id));
  }

  async portalAvailable(userId: string): Promise<boolean> {
    if (!(await this.settings.get('welcome_letter.in_portal', false))) return false;
    return (await this.latestId(userId)) !== null;
  }

  async row(letterId: string): Promise<LetterRow> {
    const r = await this.base().where('l.id', '=', letterId).executeTakeFirst();
    if (!r) throw new NotFoundException({ error: 'letter_not_found' });
    return r;
  }

  /** For tests and the renderer: the decrypted snapshot. */
  async snapshot(letterId: string): Promise<LetterSnapshot> {
    const r = await this.db
      .selectFrom('welcome_letters')
      .select('snapshot_enc')
      .where('id', '=', letterId)
      .executeTakeFirst();
    if (!r) throw new NotFoundException({ error: 'letter_not_found' });
    return this.decode(r.snapshot_enc);
  }

  private base() {
    return this.db
      .selectFrom('welcome_letters as l')
      .leftJoin('users as s', 's.id', 'l.created_by')
      .select([
        'l.id',
        'l.user_id as userId',
        'l.version',
        'l.status',
        'l.plan',
        'l.address_missing as addressMissing',
        'l.created_at as createdAt',
        'l.created_by as createdBy',
        's.display_name as createdByName',
        'l.first_downloaded_at as firstDownloadedAt',
        'l.sent_at as sentAt',
      ]);
  }

  private decode(enc: Buffer): LetterSnapshot {
    return JSON.parse(this.crypto.decrypt(enc)) as LetterSnapshot;
  }

  private async renderInput(letterId: string): Promise<RenderInput> {
    const r = await this.db
      .selectFrom('welcome_letters')
      .select(['snapshot_enc', 'company_version'])
      .where('id', '=', letterId)
      .executeTakeFirstOrThrow();
    const company = await this.company.version(r.company_version);
    return {
      snapshot: this.decode(r.snapshot_enc),
      images: { logoPng: company.logoPng, signaturePng: company.signaturePng },
    };
  }

  private async markDownloaded(ids: string[]) {
    await this.db
      .updateTable('welcome_letters')
      .set({ status: 'downloaded', first_downloaded_at: sql`now()` })
      .where('id', 'in', ids)
      .where('status', '=', 'new')
      .execute();
  }

  private async exists(userId: string): Promise<boolean> {
    return (await this.latestId(userId)) !== null;
  }

  /** Paid (subscription active or in dunning) and at least one registered vehicle. */
  private async ready(userId: string): Promise<boolean> {
    const r = await this.db
      .selectNoFrom((eb) => [
        eb
          .exists(
            eb
              .selectFrom('subscriptions')
              .select('id')
              .where('user_id', '=', userId)
              .where('status', 'in', ['active', 'past_due']),
          )
          .as('paid'),
        eb
          .exists(eb.selectFrom('vehicles').select('id').where('owner_user_id', '=', userId))
          .as('vehicle'),
      ])
      .executeTakeFirstOrThrow();
    return Boolean(r.paid) && Boolean(r.vehicle);
  }

  private async insert(
    userId: string,
    built: {
      snapshot: LetterSnapshot;
      companyVersion: number;
      plan: Plan;
      addressMissing: boolean;
    },
    staffId: string | null,
    onlyIfNone: boolean,
  ): Promise<string | null> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'welcome:' + userId}))`.execute(trx);
      const last = await trx
        .selectFrom('welcome_letters')
        .select((eb) => eb.fn.max('version').as('v'))
        .where('user_id', '=', userId)
        .executeTakeFirst();
      const current = Number(last?.v ?? 0);
      if (onlyIfNone && current > 0) return null;
      const row = await trx
        .insertInto('welcome_letters')
        .values({
          user_id: userId,
          version: current + 1,
          plan: built.plan,
          address_missing: built.addressMissing,
          snapshot_enc: this.crypto.encrypt(JSON.stringify(built.snapshot)),
          key_version: this.crypto.keyVersion,
          company_version: built.companyVersion,
          created_by: staffId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('audit_logs')
        .values({
          actor_id: staffId,
          actor_kind: staffId ? 'staff' : null,
          action: 'welcome_letter.created',
          entity: 'welcome_letters',
          entity_id: row.id,
          meta: JSON.stringify({ userId, version: current + 1 }),
        })
        .execute();
      return row.id;
    });
  }

  /** Collects the letter data now; null when the customer has no subscription or no vehicle. */
  private async build(userId: string) {
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'customer_no', 'display_name', 'stripe_customer_id'])
      .where('id', '=', userId)
      .where('kind', '=', 'customer')
      .executeTakeFirst();
    if (!user) return null;
    const sub = await this.db
      .selectFrom('subscriptions')
      .select(['plan', 'contract_no', 'created_at', 'renewal_mode', 'promo_code_id'])
      .where('user_id', '=', userId)
      .orderBy(sql`status IN ('active', 'past_due')`, 'desc')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const vehicle = await this.db
      .selectFrom('vehicles')
      .select(['plate_enc', 'make_model', 'color'])
      .where('owner_user_id', '=', userId)
      .orderBy('created_at')
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    if (!sub || !vehicle) return null;
    const plan = sub.plan as Plan;
    const address = await this.address(userId, user.stripe_customer_id);
    const company = await this.company.current();
    const price = await this.billing.priceFor(plan, sub.promo_code_id ?? undefined);
    const portal = new URL('/konto', this.env.WEB_BASE_URL);
    const snapshot: LetterSnapshot = {
      v: 1,
      date: new Date().toISOString(),
      customer: {
        customerNo: user.customer_no ?? '–',
        email: user.email,
        name: address?.name || user.display_name || '',
        address,
      },
      contract: {
        contractNo: sub.contract_no ?? '–',
        plan,
        planName: planName(plan),
        startedAt: sub.created_at.toISOString(),
        priceCents: price,
        renewalMode:
          sub.renewal_mode === 'annual' ? 'annual' : ('monthly_after_first_term' as const),
      },
      vehicle: {
        plate: vehicle.plate_enc?.length ? this.crypto.decrypt(vehicle.plate_enc) : '–',
        description: [vehicle.make_model, vehicle.color].filter(Boolean).join(', ') || null,
      },
      benefits: planBenefits(plan),
      company: company.data,
      companyVersion: company.version,
      portalUrl: `${portal.host}${portal.pathname}`,
    };
    return { snapshot, companyVersion: company.version, plan, addressMissing: !address };
  }

  /**
   * Where the letter goes: always the sign-up address when the customer has a profile (owner
   * decision 2026-11-20; the decal shipping address is for decal orders only). Accounts without a
   * profile: the shipping address of the latest decal order, otherwise the billing address entered
   * at checkout (Stripe). Kept only inside the encrypted snapshot.
   */
  private async address(
    userId: string,
    stripeCustomerId: string | null,
  ): Promise<PostalAddress | null> {
    const signup = await this.profiles.postalAddress(userId);
    if (signup) return signup;
    const order = await this.db
      .selectFrom('decal_orders')
      .select('shipping_address_enc')
      .where('user_id', '=', userId)
      .where(sql<boolean>`octet_length(shipping_address_enc) > 0`)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (order) {
      const a = JSON.parse(this.crypto.decrypt(order.shipping_address_enc)) as ShippingAddress;
      return { ...a };
    }
    if (!stripeCustomerId) return null;
    return this.payments.billingAddress(stripeCustomerId);
  }
}
