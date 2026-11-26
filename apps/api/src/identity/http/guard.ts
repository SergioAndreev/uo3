import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IdentityServices } from '../core/index.js';
import { bearerOf, type HttpRequest } from './request.js';
import { IDENTITY } from './tokens.js';

const PUBLIC = 'identity:public';
const SETUP = 'identity:setup-allowed';

/** Маршрут без Access JWT. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Маршрут доступен ограниченному токену персонала без 2FA. */
export const SetupAllowed = () => SetMetadata(SETUP, true);

/** Охранник API: подпись, срок, список отзыва, бан, ограниченный токен. */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityServices,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<HttpRequest>();
    const setup = this.reflector.getAllAndOverride<boolean>(SETUP, targets) ?? false;
    req.principal = await this.identity.auth.authenticate(bearerOf(req), setup);
    return true;
  }
}

/** Принципал, установленный охранником. */
export const principalOf = (req: HttpRequest) => {
  if (!req.principal) throw new Error('маршрут без IdentityGuard');
  return req.principal;
};
