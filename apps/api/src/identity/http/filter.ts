import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { IdentityError } from '../core/index.js';
import { clearRefreshCookie, type HttpResponse } from './request.js';
import { IDENTITY_HTTP, type IdentityHttpOptions } from './tokens.js';

/** IdentityError → `{ error: { code, message, details } }`, `Retry-After`, очистка cookie. */
@Catch(IdentityError)
export class IdentityErrorFilter implements ExceptionFilter {
  constructor(@Inject(IDENTITY_HTTP) private readonly options: IdentityHttpOptions) {}

  catch(error: IdentityError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponse>();
    if (error.options.retryAfterS !== undefined) {
      res.setHeader('retry-after', String(error.options.retryAfterS));
    }
    if (error.options.clearRefresh) clearRefreshCookie(res, this.options.secureCookies);
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.options.details ? { details: error.options.details } : {}),
      },
    });
  }
}
