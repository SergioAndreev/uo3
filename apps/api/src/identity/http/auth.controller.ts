import {
  Controller,
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
  EmailOnlyRequest,
  LoginRequest,
  LogoutAllRequest,
  MfaVerifyRequest,
  OAuthOnboardRequest,
  PasswordResetConfirmRequest,
  RegisterRequest,
  VerifyEmailRequest,
} from '@duskmarch/protocol';
import { Type } from '@sinclair/typebox';
import type { IdentityServices, IssuedSession, LoginResult } from '../core/index.js';
import { IdentityGuard, Public, SetupAllowed, principalOf } from './guard.js';
import {
  OAUTH_COOKIE,
  REFRESH_COOKIE,
  clearRefreshCookie,
  cookiesOf,
  metaOf,
  parse,
  setOAuthCookie,
  setRefreshCookie,
  type HttpRequest,
  type HttpResponse,
} from './request.js';
import { IDENTITY, IDENTITY_HTTP, type IdentityHttpOptions } from './tokens.js';

const OAuthQuery = Type.Object({
  code: Type.Optional(Type.String({ maxLength: 2048 })),
  state: Type.Optional(Type.String({ maxLength: 256 })),
});

/** Тело ответа без значения refresh; сам токен уходит в cookie. */
export function deliver(
  res: HttpResponse,
  result: LoginResult | IssuedSession | { status: string },
  secure: boolean,
  now: number,
) {
  if (!('refreshToken' in result) || result.refreshToken === undefined) return result;
  const { refreshToken, refreshExpiresAt, ...body } = result as IssuedSession;
  setRefreshCookie(res, refreshToken, (refreshExpiresAt - now) / 1000, secure);
  return body;
}

@Controller('api/v1/auth')
@UseGuards(IdentityGuard)
export class AuthController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityServices,
    @Inject(IDENTITY_HTTP) private readonly options: IdentityHttpOptions,
  ) {}

  private send(res: HttpResponse, result: LoginResult | IssuedSession | { status: string }) {
    return deliver(res, result, this.options.secureCookies, this.identity.identity.now());
  }

  @Get('documents')
  @Public()
  documents() {
    return this.identity.registration.documents();
  }

  @Post('register')
  @Public()
  @HttpCode(202)
  register(@Req() req: HttpRequest) {
    const body = parse(RegisterRequest, req.body, 'REG_VALIDATION_FAILED');
    return this.identity.registration.register(body, metaOf(req));
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  verify(@Req() req: HttpRequest) {
    return this.identity.registration.verify(
      parse(VerifyEmailRequest, req.body, 'REG_VALIDATION_FAILED').token,
    );
  }

  @Post('verify-email/resend')
  @Public()
  @HttpCode(202)
  resend(@Req() req: HttpRequest) {
    const { email } = parse(EmailOnlyRequest, req.body, 'REG_VALIDATION_FAILED');
    return this.identity.registration.resend(email, metaOf(req));
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const { email, password } = parse(LoginRequest, req.body);
    return this.send(res, await this.identity.auth.login(email, password, metaOf(req)));
  }

  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  async mfa(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const { challengeToken, code } = parse(MfaVerifyRequest, req.body);
    return this.send(
      res,
      await this.identity.tfa.verifyChallenge(challengeToken, code, metaOf(req)),
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    return this.send(
      res,
      await this.identity.auth.refresh(cookiesOf(req)[REFRESH_COOKIE], metaOf(req)),
    );
  }

  @Post('logout')
  @HttpCode(204)
  @SetupAllowed()
  async logout(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    clearRefreshCookie(res, this.options.secureCookies);
    await this.identity.auth.logout(principalOf(req), metaOf(req));
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const principal = principalOf(req);
    const { keepCurrent } = parse(LogoutAllRequest, req.body);
    if (!keepCurrent) clearRefreshCookie(res, this.options.secureCookies);
    return this.identity.auth.logoutAll(principal, keepCurrent, metaOf(req));
  }

  @Post('password-reset/request')
  @Public()
  @HttpCode(202)
  resetRequest(@Req() req: HttpRequest) {
    return this.identity.security.requestReset(
      parse(EmailOnlyRequest, req.body).email,
      metaOf(req),
    );
  }

  @Post('password-reset/confirm')
  @Public()
  @HttpCode(200)
  resetConfirm(@Req() req: HttpRequest) {
    const { token, newPassword } = parse(PasswordResetConfirmRequest, req.body);
    return this.identity.security.confirmReset(token, newPassword, metaOf(req));
  }

  @Get('oauth/:provider/start')
  @Public()
  async oauthStart(@Param('provider') provider: string, @Res() res: HttpResponse) {
    const { url, txId } = await this.identity.oauth.start(provider);
    setOAuthCookie(res, txId, this.options.secureCookies);
    res.redirect(302, url);
  }

  @Get('oauth/:provider/callback')
  @Public()
  async oauthCallback(
    @Param('provider') provider: string,
    @Query() query: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    const params = parse(OAuthQuery, query);
    const result = await this.identity.oauth.callback(
      provider,
      params,
      cookiesOf(req)[OAUTH_COOKIE],
      metaOf(req),
    );
    return this.send(res, result);
  }

  @Post('oauth/onboard')
  @Public()
  @HttpCode(200)
  async oauthOnboard(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const body = parse(OAuthOnboardRequest, req.body);
    return this.send(res, await this.identity.oauth.onboard(body, metaOf(req)));
  }
}

/** Публичные ключи Access JWT. */
@Controller('.well-known')
export class JwksController {
  constructor(@Inject(IDENTITY) private readonly identity: IdentityServices) {}

  @Get('jwks.json')
  jwks() {
    return this.identity.identity.deps.keys.jwks(this.identity.identity.now());
  }
}
