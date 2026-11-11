import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import type { AlertSeverity } from '../db/types.generated';
import { SETTINGS } from './settings-registry';
import { StaffService, type StaffContext } from './staff.service';

/**
 * US-41 / AD-14 / AD-15: settings and kill switches without a deploy. Every change is versioned
 * (optimistic: the editor sends the version it saw), audited with old and new value, and broadcast
 * so every API and worker process uses it within seconds (60 s at most, the cache TTL is 30 s).
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  async list() {
    const rows = await this.db
      .selectFrom('app_settings as s')
      .leftJoin('users as u', 'u.id', 's.updated_by')
      .select([
        's.key',
        's.value',
        's.version',
        's.updated_at as updatedAt',
        'u.display_name as updatedBy',
      ])
      .execute();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const types = await this.db
      .selectFrom('alert_types')
      .select([
        'code',
        'severity',
        'escalates',
        'label_de as labelDe',
        'label_en as labelEn',
        'is_active as active',
        'sort_order as sortOrder',
      ])
      .orderBy('sort_order')
      .execute();
    return {
      settings: Object.entries(SETTINGS).map(([key, def]) => {
        const row = byKey.get(key);
        return {
          key,
          group: def.group,
          killSwitch: Boolean(def.killSwitch),
          value: row ? row.value : def.default,
          default: def.default,
          version: row?.version ?? 0,
          updatedAt: row?.updatedAt ?? null,
          updatedBy: row?.updatedBy ?? null,
        };
      }),
      alertTypes: types,
    };
  }

  async update(
    by: StaffContext,
    key: string,
    input: { value: unknown; version: number; reason?: string },
  ) {
    const def = SETTINGS[key];
    if (!def) throw new NotFoundException({ error: 'unknown_setting' });
    const parsed = def.schema.safeParse(input.value);
    if (!parsed.success) throw new BadRequestException({ error: 'invalid_value' });
    if (def.killSwitch && !input.reason?.trim())
      throw new BadRequestException({ error: 'reason_required' });

    const result = await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('app_settings')
        .select(['value', 'version'])
        .where('key', '=', key)
        .forUpdate()
        .executeTakeFirst();
      if ((current?.version ?? 0) !== input.version)
        throw new ConflictException({ error: 'version_conflict', version: current?.version ?? 0 });
      const value = JSON.stringify(parsed.data);
      const row = current
        ? await trx
            .updateTable('app_settings')
            .set({
              value,
              version: sql`version + 1`,
              updated_by: by.userId,
              updated_at: sql`now()`,
            })
            .where('key', '=', key)
            .returning('version')
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('app_settings')
            .values({ key, value, updated_by: by.userId })
            .returning('version')
            .executeTakeFirstOrThrow();
      return { old: current ? current.value : def.default, version: row.version };
    });
    await this.staff.audit(
      by.userId,
      def.killSwitch ? 'settings.kill_switch' : 'settings.update',
      'app_settings',
      null,
      {
        key,
        old: result.old,
        new: parsed.data,
        version: result.version,
        reason: input.reason ?? null,
      },
    );
    await this.settings.broadcastChange();
    return { key, value: parsed.data, version: result.version };
  }

  /** Change history of one setting, from the audit log (the only place it is kept). */
  async history(key: string) {
    if (!SETTINGS[key]) throw new NotFoundException({ error: 'unknown_setting' });
    const rows = await this.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select(['a.id', 'a.meta', 'a.created_at as at', 'u.display_name as by'])
      .where('a.entity', '=', 'app_settings')
      .where('a.action', 'in', ['settings.update', 'settings.kill_switch'])
      .where(sql<boolean>`a.meta->>'key' = ${key}`)
      .orderBy('a.id', 'desc')
      .limit(50)
      .execute();
    return {
      history: rows.map((r) => {
        const m = r.meta as { old: unknown; new: unknown; version: number; reason: string | null };
        return {
          id: Number(r.id),
          at: r.at,
          by: r.by,
          old: m.old,
          new: m.new,
          version: m.version,
          reason: m.reason,
        };
      }),
    };
  }

  /** AD-14: alert type activation, severity, escalation flag and the button texts on the scanner page. */
  async updateAlertType(
    by: StaffContext,
    code: string,
    input: {
      active?: boolean;
      severity?: AlertSeverity;
      escalates?: boolean;
      labelDe?: string;
      labelEn?: string;
    },
  ) {
    const before = await this.db
      .selectFrom('alert_types')
      .select(['is_active', 'severity', 'escalates', 'label_de', 'label_en'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!before) throw new NotFoundException({ error: 'unknown_alert_type' });
    // "Custom message" stays available: without it a scanner could not describe anything else.
    if (code === 'custom' && input.active === false)
      throw new BadRequestException({ error: 'custom_required' });
    await this.db
      .updateTable('alert_types')
      .set({
        ...(input.active !== undefined ? { is_active: input.active } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.escalates !== undefined ? { escalates: input.escalates } : {}),
        ...(input.labelDe ? { label_de: input.labelDe } : {}),
        ...(input.labelEn ? { label_en: input.labelEn } : {}),
      })
      .where('code', '=', code)
      .execute();
    await this.staff.audit(by.userId, 'settings.alert_type', 'alert_types', null, {
      code,
      old: before,
      new: input,
    });
  }
}
