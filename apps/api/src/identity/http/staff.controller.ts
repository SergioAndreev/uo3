import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AccessLevelChangeRequest,
  BanRequest,
  EffectiveLevelRequest,
  ReasonRequest,
} from '@duskmarch/protocol';
import type { IdentityServices } from '../core/index.js';
import { pageQuery } from './account.controller.js';
import { IdentityGuard, principalOf } from './guard.js';
import { metaOf, parse, type HttpRequest } from './request.js';
import { IDENTITY } from './tokens.js';

/** Эндпоинты персонала; права проверяет StaffService по матрице разрешений. */
@Controller('api/v1/staff')
@UseGuards(IdentityGuard)
export class StaffController {
  constructor(@Inject(IDENTITY) private readonly identity: IdentityServices) {}

  @Get('accounts/:id')
  inspect(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.identity.staff.inspect(principalOf(req), id, metaOf(req));
  }

  @Post('accounts/:id/bans')
  @HttpCode(201)
  ban(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.identity.staff.ban(principalOf(req), id, parse(BanRequest, req.body), metaOf(req));
  }

  @Post('bans/:id/lift')
  @HttpCode(204)
  async lift(@Param('id') id: string, @Req() req: HttpRequest) {
    await this.identity.staff.lift(
      principalOf(req),
      id,
      parse(ReasonRequest, req.body).reason,
      metaOf(req),
    );
  }

  @Post('accounts/:id/sessions/revoke')
  @HttpCode(200)
  revoke(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.identity.staff.revokeSessions(principalOf(req), id, metaOf(req));
  }

  @Post('accounts/:id/2fa/reset')
  @HttpCode(204)
  async resetTfa(@Param('id') id: string, @Req() req: HttpRequest) {
    await this.identity.staff.resetTwoFactor(
      principalOf(req),
      id,
      parse(ReasonRequest, req.body).reason,
      metaOf(req),
    );
  }

  @Post('accounts/:id/access-level')
  @HttpCode(200)
  level(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.identity.staff.changeLevel(
      principalOf(req),
      id,
      parse(AccessLevelChangeRequest, req.body),
      metaOf(req),
    );
  }

  @Post('effective-level')
  @HttpCode(200)
  effective(@Req() req: HttpRequest) {
    return this.identity.staff.setEffective(
      principalOf(req),
      parse(EffectiveLevelRequest, req.body).level,
      metaOf(req),
    );
  }

  @Get('audit')
  audit(@Req() req: HttpRequest, @Query() query: unknown) {
    const { limit, cursor } = pageQuery(query);
    return this.identity.staff.auditLog(principalOf(req), metaOf(req), limit ?? 50, cursor);
  }
}
