import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  EmailChangeConfirmRequest,
  EmailChangeRequest,
  PageQuery,
  PasswordChangeRequest,
  ReauthRequest,
  TfaCodeRequest,
  TfaConfirmRequest,
} from '@duskmarch/protocol';
import { Type } from '@sinclair/typebox';
import type { IdentityServices } from '../core/index.js';
import { deliver } from './auth.controller.js';
import { IdentityGuard, Public, SetupAllowed, principalOf } from './guard.js';
import { metaOf, parse, setOAuthCookie, type HttpRequest, type HttpResponse } from './request.js';
import { IDENTITY, IDENTITY_HTTP, type IdentityHttpOptions } from './tokens.js';

const PasswordBody = Type.Object(
  { password: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })) },
  { additionalProperties: false },
);

/** Строковые параметры страницы → числа. */
export function pageQuery(query: unknown) {
  const raw = (query ?? {}) as Record<string, unknown>;
  const value = {
    ...(raw['limit'] === undefined ? {} : { limit: Number(raw['limit']) }),
    ...(raw['cursor'] === undefined ? {} : { cursor: raw['cursor'] }),
  };
  return parse(PageQuery, value);
}

@Controller('api/v1/account')
@UseGuards(IdentityGuard)
export class AccountController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityServices,
    @Inject(IDENTITY_HTTP) private readonly options: IdentityHttpOptions,
  ) {}

  @Get('sessions')
  sessions(@Req() req: HttpRequest) {
    return this.identity.auth.listSessions(principalOf(req));
  }

  @Delete('sessions/:sid')
  @HttpCode(204)
  async revoke(@Param('sid') sid: string, @Req() req: HttpRequest) {
    await this.identity.auth.revokeOwn(principalOf(req), sid, 'user_revoke', metaOf(req));
  }

  @Get('security-events')
  events(@Req() req: HttpRequest, @Query() query: unknown) {
    const { limit, cursor } = pageQuery(query);
    return this.identity.security.events(principalOf(req), limit ?? 50, cursor);
  }

  @Post('reauth')
  @HttpCode(200)
  reauth(@Req() req: HttpRequest) {
    return this.identity.security.reauth(principalOf(req), parse(ReauthRequest, req.body));
  }

  @Post('password')
  @HttpCode(200)
  password(@Req() req: HttpRequest) {
    return this.identity.security.changePassword(
      principalOf(req),
      parse(PasswordChangeRequest, req.body),
      metaOf(req),
    );
  }

  @Post('email/change-request')
  @HttpCode(202)
  emailChange(@Req() req: HttpRequest) {
    return this.identity.security.requestEmailChange(
      principalOf(req),
      parse(EmailChangeRequest, req.body),
      metaOf(req),
    );
  }

  @Post('email/change-confirm')
  @HttpCode(200)
  @Public()
  emailConfirm(@Req() req: HttpRequest) {
    return this.identity.security.confirmEmailChange(
      parse(EmailChangeConfirmRequest, req.body).token,
      metaOf(req),
    );
  }

  @Get('2fa')
  tfaStatus(@Req() req: HttpRequest) {
    return this.identity.tfa.status(principalOf(req));
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @SetupAllowed()
  tfaSetup(@Req() req: HttpRequest) {
    return this.identity.tfa.setup(principalOf(req), parse(PasswordBody, req.body ?? {}).password);
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  @SetupAllowed()
  async tfaConfirm(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const { setupToken, code } = parse(TfaConfirmRequest, req.body);
    const result = await this.identity.tfa.confirm(principalOf(req), setupToken, code, metaOf(req));
    const session = deliver(
      res,
      result.session,
      this.options.secureCookies,
      this.identity.identity.now(),
    );
    return { backupCodes: result.backupCodes, session };
  }

  @Post('2fa/backup-codes')
  @HttpCode(200)
  tfaBackup(@Req() req: HttpRequest) {
    const { code, password } = parse(TfaCodeRequest, req.body);
    return this.identity.tfa.regenerateBackupCodes(principalOf(req), code, password, metaOf(req));
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async tfaDisable(@Req() req: HttpRequest) {
    const { code, password } = parse(TfaCodeRequest, req.body);
    await this.identity.tfa.disable(principalOf(req), code, password, metaOf(req));
  }

  @Get('oauth')
  async oauth(@Req() req: HttpRequest) {
    return { providers: await this.identity.oauth.providers(principalOf(req).accountId) };
  }

  @Post('oauth/:provider/link')
  @HttpCode(200)
  async link(
    @Param('provider') provider: string,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    const { url, txId } = await this.identity.oauth.start(provider, principalOf(req));
    setOAuthCookie(res, txId, this.options.secureCookies);
    return { url };
  }

  @Delete('oauth/:provider')
  @HttpCode(200)
  unlink(@Param('provider') provider: string, @Req() req: HttpRequest) {
    const { password } = parse(PasswordBody, req.body ?? {});
    return this.identity.oauth.unlink(principalOf(req), provider, password, metaOf(req));
  }
}
