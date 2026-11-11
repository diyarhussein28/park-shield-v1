import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PublicAppModule } from '../apps';
import { SessionGuard } from '../auth/guards';
import { loadEnv, type Env } from '../config/env';
import { createLogger } from '../core/logger';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
export type Ctrl = new (...a: never[]) => object;

export interface PublicRoute {
  method: string;
  path: string;
  route: string;
  session: boolean;
  controller: Ctrl;
}

/** Every route of the public API as registered for `env`, with whether it needs a customer session. */
export function publicRoutes(env: Env = loadEnv()): PublicRoute[] {
  const controllers = (PublicAppModule.forRoot(env, createLogger(env)).controllers ?? []) as Ctrl[];
  const out: PublicRoute[] = [];
  for (const ctrl of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? []) as unknown[];
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      // Descriptors, not property access: getters on controllers must not run here.
      const handler = Object.getOwnPropertyDescriptor(ctrl.prototype, name)?.value as unknown;
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const p = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (p === undefined) continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number]!;
      const guards = [
        ...classGuards,
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[]),
      ];
      const path = `/${[base, p].filter((x) => x && x !== '/').join('/')}`;
      out.push({
        method,
        path,
        route: `${method} ${path}`,
        session: guards.includes(SessionGuard),
        controller: ctrl,
      });
    }
  }
  return out;
}

export const publicRoutesForIdor = () => publicRoutes().filter((r) => r.session);
