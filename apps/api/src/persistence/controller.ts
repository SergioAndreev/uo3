import { Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  CharacterRollbackApply,
  CharacterRollbackPreview,
  FlushRequest,
  ItemRestoreRequest,
  LedgerQuery,
  Reason,
  RestorePointRequest,
} from '@duskmarch/protocol';
import { Type } from '@sinclair/typebox';
import { IdentityError } from '../identity/core/errors.js';
import { IdentityGuard, principalOf } from '../identity/http/guard.js';
import { metaOf, parse, type HttpRequest } from '../identity/http/request.js';
import type { PersistenceAdmin } from './index.js';
import type { RestoreAdmin } from './restore.js';

export const PERSISTENCE = Symbol('persistence');
export const RESTORE = Symbol('restore');
const UndoRequest = Type.Object({ reason: Reason }, { additionalProperties: false });

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
  constructor(
    @Inject(PERSISTENCE) private readonly admin: PersistenceAdmin,
    @Inject(RESTORE) private readonly restore: RestoreAdmin,
  ) {}

  @Get('backups/:backupId')
  backup(
    @Param('shardId') _shardId: string,
    @Param('backupId') backupId: string,
    @Req() req: HttpRequest,
  ) {
    return this.admin.backup(principalOf(req), metaOf(req), backupId);
  }

  @Post('rollbacks/character/preview')
  @HttpCode(200)
  preview(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(CharacterRollbackPreview, req.body ?? {});
    return this.restore.preview(
      principalOf(req),
      metaOf(req),
      shardId,
      body.characterId,
      new Date(body.targetTime),
    );
  }

  @Post('rollbacks/character/apply')
  @HttpCode(200)
  applyCharacter(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(CharacterRollbackApply, req.body ?? {});
    return this.restore.applyCharacter(principalOf(req), metaOf(req), shardId, body);
  }

  @Post('rollbacks/item')
  @HttpCode(200)
  restoreItem(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(ItemRestoreRequest, req.body ?? {});
    return this.restore.restoreItem(principalOf(req), metaOf(req), shardId, body);
  }

  @Post('restore-operations/:operationId/undo')
  @HttpCode(200)
  undo(
    @Param('shardId') shardId: string,
    @Param('operationId') operationId: string,
    @Req() req: HttpRequest,
  ) {
    const body = parse(UndoRequest, req.body ?? {});
    return this.restore.undo(principalOf(req), metaOf(req), shardId, operationId, body.reason);
  }

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

  @Post('restore-points')
  @HttpCode(201)
  restorePoint(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(RestorePointRequest, req.body ?? {});
    return this.admin.restorePoint(principalOf(req), metaOf(req), shardId, body.name, body.reason);
  }

  @Post('flush')
  @HttpCode(200)
  flush(@Param('shardId') shardId: string, @Req() req: HttpRequest) {
    const body = parse(FlushRequest, req.body ?? {});
    return this.admin.flush(principalOf(req), metaOf(req), shardId, body.force === true);
  }
}
