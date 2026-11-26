import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CharacterCreateRequest,
  DeleteCharacterRequest,
  NameRequest,
  ShardCreateRequest,
  ShardStatusRequest,
  ShardUpdateRequest,
  StaffReasonRequest,
  TicketRequest,
} from '@duskmarch/protocol';
import type { IdentityServices, Principal } from '../../identity/core/index.js';
import { IdentityGuard, Public, principalOf } from '../../identity/http/guard.js';
import {
  bearerOf,
  metaOf,
  parse,
  type HttpRequest,
  type HttpResponse,
} from '../../identity/http/request.js';
import { IDENTITY } from '../../identity/http/tokens.js';
import type { GameServices } from '../index.js';
import type { ShardRecord } from '../ports.js';
import { GAME } from './tokens.js';

const header = (req: HttpRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

@Controller('api/v1/shards')
@UseGuards(IdentityGuard)
export class ShardsController {
  constructor(
    @Inject(GAME) private readonly game: GameServices,
    @Inject(IDENTITY) private readonly identity: IdentityServices,
  ) {}

  /** Принципал, если токен передан; просроченный токен — ошибка, а не аноним. */
  private async optional(req: HttpRequest): Promise<Principal | null> {
    const token = bearerOf(req);
    return token ? this.identity.auth.authenticate(token) : null;
  }

  private viewer = async (req: HttpRequest) => ({
    principal: await this.optional(req),
    protocol: this.game.shards.protocol(header(req, 'x-duskmarch-protocol')),
  });

  @Get()
  @Public()
  async list(@Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse) {
    const viewer = await this.viewer(req);
    const { items, etag, degraded } = await this.game.shards.list(viewer);
    if (degraded) res.setHeader('warning', '199 duskmarch "живое состояние шардов недоступно"');
    if (viewer.principal === null) {
      res.setHeader('etag', etag);
      if (header(req, 'if-none-match') === etag) {
        res.status(304);
        return undefined;
      }
    }
    return items;
  }

  @Get(':id')
  @Public()
  async card(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.game.shards.card(id, await this.viewer(req));
  }

  @Get(':id/creation-options')
  @Public()
  async options(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.game.characters.options(id, await this.optional(req));
  }

  @Post(':id/names/validate')
  @HttpCode(200)
  validate(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.game.characters.validateName(
      principalOf(req),
      id,
      parse(NameRequest, req.body, 'CHAR_VALIDATION_FAILED').name,
    );
  }

  @Get(':id/characters')
  characters(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.game.characters.list(principalOf(req), id);
  }

  @Post(':id/characters')
  @HttpCode(201)
  create(@Param('id') id: string, @Req() req: HttpRequest) {
    const body = parse(CharacterCreateRequest, req.body, 'CHAR_VALIDATION_FAILED');
    return this.game.characters.create(
      principalOf(req),
      id,
      body,
      header(req, 'idempotency-key'),
      metaOf(req),
    );
  }

  @Delete(':id/characters/:cid')
  @HttpCode(200)
  remove(@Param('id') id: string, @Param('cid') cid: string, @Req() req: HttpRequest) {
    const { confirmName } = parse(DeleteCharacterRequest, req.body, 'CHAR_VALIDATION_FAILED');
    return this.game.characters.remove(principalOf(req), id, cid, confirmName, metaOf(req));
  }

  @Post(':id/characters/:cid/restore')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Param('cid') cid: string, @Req() req: HttpRequest) {
    return this.game.characters.cancelDeletion(principalOf(req), id, cid);
  }

  @Post(':id/characters/:cid/rename')
  @HttpCode(200)
  rename(@Param('id') id: string, @Param('cid') cid: string, @Req() req: HttpRequest) {
    return this.game.characters.rename(
      principalOf(req),
      id,
      cid,
      parse(NameRequest, req.body, 'CHAR_VALIDATION_FAILED').name,
    );
  }

  @Post(':id/tickets')
  @HttpCode(201)
  ticket(@Param('id') id: string, @Req() req: HttpRequest) {
    const body = parse(TicketRequest, req.body, 'CHAR_VALIDATION_FAILED');
    return this.game.tickets.issue(
      principalOf(req),
      id,
      body,
      this.game.shards.protocol(header(req, 'x-duskmarch-protocol')),
    );
  }
}

@Controller('api/v1/admin/shards')
@UseGuards(IdentityGuard)
export class AdminShardsController {
  constructor(@Inject(GAME) private readonly game: GameServices) {}

  @Post()
  @HttpCode(201)
  create(@Req() req: HttpRequest) {
    const body = parse(ShardCreateRequest, req.body, 'SHARD_VALIDATION_FAILED');
    return this.game.shards.create(
      principalOf(req),
      body as Parameters<GameServices['shards']['create']>[1],
      metaOf(req),
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Req() req: HttpRequest) {
    const body = parse(ShardUpdateRequest, req.body, 'SHARD_VALIDATION_FAILED');
    return this.game.shards.update(principalOf(req), id, body as Partial<ShardRecord>, metaOf(req));
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id') id: string, @Req() req: HttpRequest) {
    return this.game.shards.setStatus(
      principalOf(req),
      id,
      parse(ShardStatusRequest, req.body, 'SHARD_VALIDATION_FAILED'),
      metaOf(req),
    );
  }
}

@Controller('api/v1/staff/characters')
@UseGuards(IdentityGuard)
export class StaffCharactersController {
  constructor(@Inject(GAME) private readonly game: GameServices) {}

  private reason(req: HttpRequest) {
    return parse(StaffReasonRequest, req.body, 'CHAR_VALIDATION_FAILED').reason;
  }

  @Post(':cid/rename-required')
  @HttpCode(204)
  async renameRequired(@Param('cid') cid: string, @Req() req: HttpRequest) {
    await this.game.characters.requireRename(principalOf(req), cid, this.reason(req), metaOf(req));
  }

  @Post(':cid/lock')
  @HttpCode(204)
  async lock(@Param('cid') cid: string, @Req() req: HttpRequest) {
    await this.game.characters.lock(principalOf(req), cid, this.reason(req), metaOf(req));
  }

  @Post(':cid/unlock')
  @HttpCode(204)
  async unlock(@Param('cid') cid: string, @Req() req: HttpRequest) {
    await this.game.characters.unlock(principalOf(req), cid, this.reason(req), metaOf(req));
  }

  @Post(':cid/restore')
  @HttpCode(200)
  restore(@Param('cid') cid: string, @Req() req: HttpRequest) {
    return this.game.characters.restoreDeleted(
      principalOf(req),
      cid,
      this.reason(req),
      metaOf(req),
    );
  }
}
