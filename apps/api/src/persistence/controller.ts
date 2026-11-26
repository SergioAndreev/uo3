import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { FlushRequest, LedgerQuery } from '@duskmarch/protocol';
import { IdentityError } from '../identity/core/errors.js';
import { IdentityGuard, principalOf } from '../identity/http/guard.js';
import { metaOf, parse, type HttpRequest } from '../identity/http/request.js';
import type { PersistenceAdmin } from './index.js';

export const PERSISTENCE = Symbol('persistence');

const itemIdOf = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 0xffff_ffff) {
    throw new IdentityError('SEC_VALIDATION_FAILED', 'идентификатор предмета', {
      details: { fields: ['/itemId'] },
    });
  }
  return id;
};

/** Числа из строки запроса. */
function queryOf(req: HttpRequest): Record<string, unknown> {
  const q = { ...((req as { query?: Record<string, unknown> }).query ?? {}) };
  for (const key of ['itemId', 'limit']) {
    if (typeof q[key] === 'string' && /^\d+$/.test(q[key] as string)) q[key] = Number(q[key]);
  }
  return q;
}

@Controller('api/v1/admin/shards/:shardId/persistence')
@UseGuards(IdentityGuard)
export class AdminPersistenceController {
  constructor(@Inject(PERSISTENCE) private readonly admin: PersistenceAdmin) {}

  @Get('ledger/items/:itemId')
  item(
    @Param('shardId') shardId: string,
    @Param('itemId') itemId: string,
    @Req() req: HttpRequest,
  ) {
    return this.admin.itemHistory(principalOf(req), metaOf(req), shardId, itemIdOf(itemId));
  }

  @Get('ledger/items/:itemId/lineage')
  lineage(
    @Param('shardId') shardId: string,
    @Param('itemId') itemId: string,
    @Req() req: HttpRequest,
  ) {
    return this.admin.lineage(principalOf(req), metaOf(req), shardId, itemIdOf(itemId));
  }

  @Get('ledger')
  query(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const q = parse(LedgerQuery, queryOf(req));
    if (q.itemId !== undefined)
      return this.admin.itemHistory(principalOf(req), metaOf(req), shardId, q.itemId);
    const after = q.cursor !== undefined && /^\d+$/.test(q.cursor) ? Number(q.cursor) : undefined;
    return this.admin.query(principalOf(req), metaOf(req), shardId, {
      ...(q.characterId ? { characterId: q.characterId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.txId ? { txId: q.txId } : {}),
      ...(q.from ? { from: new Date(q.from) } : {}),
      ...(q.to ? { to: new Date(q.to) } : {}),
      ...(after !== undefined ? { after } : {}),
      limit: q.limit ?? 100,
    });
  }

  @Post('flush')
  @HttpCode(200)
  flush(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(FlushRequest, req.body ?? {});
    return this.admin.flush(principalOf(req), metaOf(req), shardId, body.force === true);
  }
}
