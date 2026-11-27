import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  PROFILE_MAX_BYTES,
  type ClientProfilePatch,
  type ProfileCategory,
} from '@duskmarch/protocol';
import { Type } from '@sinclair/typebox';
import { IdentityError } from '../identity/core/errors.js';
import { IdentityGuard, principalOf } from '../identity/http/guard.js';
import { parse, type HttpRequest, type HttpResponse } from '../identity/http/request.js';
import { etagOf, expectedRevisionOf, type ProfileService } from './index.js';

export const PROFILES = Symbol('client-profiles');

const header = (req: HttpRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Оболочка запроса: ревизия и полезная нагрузка (состав полезной нагрузки проверяет сервис). */
const PutBody = Type.Object(
  { expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })), profile: Type.Unknown() },
  { additionalProperties: false },
);
const PatchBody = Type.Object(
  {
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    changes: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);
const ResetBody = Type.Object(
  {
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    categories: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 5 })),
  },
  { additionalProperties: false },
);

@Controller('api/v1/account/client-profile')
@UseGuards(IdentityGuard)
export class ClientProfileController {
  constructor(@Inject(PROFILES) private readonly profiles: ProfileService) {}

  private size(req: HttpRequest): void {
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > PROFILE_MAX_BYTES + 1_024) {
      throw new IdentityError('PROFILE_PAYLOAD_TOO_LARGE', 'тело больше 64 КиБ');
    }
  }

  private send(res: HttpResponse, envelope: { revision: number }) {
    res.setHeader('etag', etagOf(envelope.revision));
    return envelope;
  }

  @Get()
  async get(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const envelope = await this.profiles.get(principalOf(req));
    res.setHeader('etag', etagOf(envelope.revision));
    if (header(req, 'if-none-match') === etagOf(envelope.revision)) {
      res.status(304);
      return undefined;
    }
    return envelope;
  }

  @Put()
  async put(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    this.size(req);
    const body = parse(PutBody, req.body ?? {}, 'PROFILE_VALIDATION_FAILED');
    return this.send(
      res,
      await this.profiles.put(
        principalOf(req),
        expectedRevisionOf(header(req, 'if-match'), body.expectedRevision),
        body.profile,
      ),
    );
  }

  @Patch()
  async patch(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    this.size(req);
    const body = parse(PatchBody, req.body ?? {}, 'PROFILE_VALIDATION_FAILED');
    return this.send(
      res,
      await this.profiles.patch(
        principalOf(req),
        expectedRevisionOf(header(req, 'if-match'), body.expectedRevision),
        body.changes as ClientProfilePatch['changes'],
      ),
    );
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const body = parse(ResetBody, req.body ?? {}, 'PROFILE_VALIDATION_FAILED');
    const categories = body.categories as ProfileCategory[] | undefined;
    if (
      categories?.some(
        (c) => !['graphics', 'audio', 'gameplay', 'interface', 'controls'].includes(c),
      )
    ) {
      throw new IdentityError('PROFILE_VALIDATION_FAILED', 'неизвестная категория', {
        details: { fields: ['/categories'] },
      });
    }
    return this.send(
      res,
      await this.profiles.reset(
        principalOf(req),
        expectedRevisionOf(header(req, 'if-match'), body.expectedRevision),
        categories,
      ),
    );
  }
}
