import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { maskPhone } from '../channels/channels.service';
import { ProfileInput, ProfileService, type Profile } from './profile.service';

/** Default of `app.lock_after_seconds` (settings registry); the database value wins. */
export const LOCK_AFTER_SECONDS_DEFAULT = 300;

@Controller('v1')
@UseGuards(SessionGuard)
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  private async view(user: AuthContext, profile: Profile | null) {
    // The optional mobile number is the verified SMS channel (one copy only), shown masked.
    const sms = await this.db
      .selectFrom('contact_channels')
      .select('address_enc')
      .where('user_id', '=', user.userId)
      .where('type', '=', 'sms')
      .where('verified_at', 'is not', null)
      .executeTakeFirst();
    const contract = await this.db
      .selectFrom('subscriptions')
      .select('id')
      .where('user_id', '=', user.userId)
      .limit(1)
      .executeTakeFirst();
    return {
      email: user.email,
      complete: Boolean(profile),
      // Never had a contract: completing the profile is part of the sign-up (the app shows the
      // sign-up steps; the profile source becomes `signup`).
      newAccount: !contract,
      profile: profile && {
        firstName: profile.firstName,
        lastName: profile.lastName,
        street: profile.street,
        postalCode: profile.postalCode,
        city: profile.city,
        country: profile.country,
        source: profile.source,
        completedAt: profile.completedAt,
      },
      phone: sms?.address_enc ? maskPhone(this.crypto.decrypt(sms.address_enc)) : null,
    };
  }

  @Get('me/profile')
  async get(@CurrentUser() user: AuthContext) {
    return this.view(user, await this.profiles.get(user.userId));
  }

  @Put('me/profile')
  async put(@CurrentUser() user: AuthContext, @Body(new ZodPipe(ProfileInput)) body: ProfileInput) {
    return this.view(user, await this.profiles.save(user.userId, body));
  }

  /** What the native app needs from the settings (signed in only). */
  @Get('app/config')
  async appConfig() {
    return {
      lockAfterSeconds: await this.settings.get<number>(
        'app.lock_after_seconds',
        LOCK_AFTER_SECONDS_DEFAULT,
      ),
    };
  }
}
