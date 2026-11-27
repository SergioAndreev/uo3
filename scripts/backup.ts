import { execFileSync, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createDbClient } from '@duskmarch/db';
import { backups, checkWorldInvariants, insertRestorePoint } from '@duskmarch/db/world';
import { readRootEnv } from './lib/env-files.js';

export type BackupKind = 'daily' | 'weekly' | 'monthly' | 'adhoc';
const DAY = 86_400_000;

/** Политика хранения: 7 ежедневных, 4 еженедельных, 3 ежемесячных. */
export function retentionUntil(kind: BackupKind, created: Date): Date {
  const days = { daily: 7, adhoc: 7, weekly: 28, monthly: 92 }[kind];
  return new Date(created.getTime() + days * DAY);
}

/** Вид планового снимка по дате: первое число — ежемесячный, воскресенье — еженедельный. */
export const kindOf = (d: Date): BackupKind =>
  d.getUTCDate() === 1 ? 'monthly' : d.getUTCDay() === 0 ? 'weekly' : 'daily';

const MAGIC = Buffer.from('DMB1');

/** Шифрование файла AES-256-GCM: `DMB1 | iv(12) | шифротекст | тег(16)`. */
export async function encryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((r, j) =>
    out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? j(e) : r())),
  );
}

export async function decryptFile(src: string, dst: string, key: Buffer): Promise<void> {
  const size = statSync(src).size;
  const fd = openSync(src, 'r');
  const head = Buffer.alloc(16);
  const tag = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  readSync(fd, tag, 0, 16, size - 16);
  closeSync(fd);
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('не архив Duskmarch');
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(4, 16));
  decipher.setAuthTag(tag);
  await pipeline(
    createReadStream(src, { start: 16, end: size - 17 }),
    decipher,
    createWriteStream(dst),
  );
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Метка PITR в формате PostgreSQL (`YYYY-MM-DD HH:MM:SS.mmm+00`). */
export function pgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`метка времени: ${iso}`);
  return d.toISOString().replace('T', ' ').replace('Z', '+00');
}

/** Настройки восстановления для временного экземпляра. */
export function recoveryConf(target?: string): string {
  return [
    "restore_command = 'cp /wal/%f %p'",
    "recovery_target_action = 'promote'",
    "archive_mode = 'off'",
    ...(target ? [`recovery_target_time = '${pgTime(target)}'`] : []),
  ].join('\n');
}

interface Ctx {
  root: string;
  env: Record<string, string | undefined>;
  container: string;
  user: string;
  password: string;
  dir: string;
  databaseUrl: string;
}

function context(root: string): Ctx {
  const env = readRootEnv(root);
  return {
    root,
    env,
    container: `${env['COMPOSE_PROJECT_NAME'] ?? 'duskmarch'}-postgres-1`,
    user: env['PG_USER'] ?? 'duskmarch',
    password: env['PG_PASSWORD'] ?? 'CHANGE_ME_LOCAL_DEV_ONLY',
    dir: resolve(root, env['BACKUP_DIR'] ?? '.local/backup'),
    databaseUrl: env['DATABASE_URL'] ?? '',
  };
}

/** Ключ шифрования: `BACKUP_ENCRYPTION_KEY` (64 hex) или локальный файл стенда. */
function keyOf(ctx: Ctx): { key: Buffer; id: string } {
  const hex = ctx.env['BACKUP_ENCRYPTION_KEY'];
  let key: Buffer;
  if (hex) key = Buffer.from(hex, 'hex');
  else {
    const file = join(ctx.dir, 'local.key');
    if (!existsSync(file)) {
      mkdirSync(ctx.dir, { recursive: true });
      writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  }
  if (key.length !== 32) throw new Error('ключ шифрования копий — 32 байта');
  return { key, id: `sha256:${createHash('sha256').update(key).digest('hex').slice(0, 16)}` };
}

const docker = (args: string[], input?: string) =>
  execFileSync('docker', args, { encoding: 'utf8', ...(input ? { input } : {}) }).trim();
const psql = (ctx: Ctx, query: string) =>
  docker([
    'exec',
    '-e',
    `PGPASSWORD=${ctx.password}`,
    ctx.container,
    'psql',
    '-h',
    '127.0.0.1',
    '-U',
    ctx.user,
    '-d',
    'duskmarch_dev',
    '-Atc',
    query,
  ]);

async function withDb<T>(
  ctx: Ctx,
  fn: (db: ReturnType<typeof createDbClient>['db']) => Promise<T>,
): Promise<T> {
  const client = createDbClient(ctx.databaseUrl);
  try {
    return await fn(client.db);
  } finally {
    await client.close();
  }
}

/** Снимок: `pg_basebackup` в контейнере, шифрование, контрольная сумма, каталог. */
export async function snapshot(ctx: Ctx, kind: BackupKind = kindOf(new Date())): Promise<string> {
  const id = randomUUID();
  const created = new Date();
  const { key, id: keyId } = keyOf(ctx);
  await withDb(ctx, (db) =>
    backups.insert(db, {
      id,
      kind,
      status: 'running',
      location: join(ctx.dir, id),
      retentionUntil: retentionUntil(kind, created),
      createdAt: created,
      encryptionKeyId: keyId,
    }),
  );
  try {
    const walStart = psql(ctx, 'select pg_current_wal_lsn()');
    docker([
      'exec',
      '-e',
      `PGPASSWORD=${ctx.password}`,
      '-u',
      'postgres',
      ctx.container,
      'pg_basebackup',
      '-h',
      '127.0.0.1',
      '-U',
      ctx.user,
      '-D',
      `/backups/${id}`,
      '-Ft',
      '-z',
      '-X',
      'fetch',
      '--checkpoint=fast',
      '-l',
      id,
    ]);
    const walEnd = psql(ctx, 'select pg_switch_wal()');
    const tmp = mkdtempSync(join(tmpdir(), 'dm-backup-'));
    docker(['cp', `${ctx.container}:/backups/${id}/base.tar.gz`, join(tmp, 'base.tar.gz')]);
    docker(['exec', ctx.container, 'rm', '-rf', `/backups/${id}`]);
    mkdirSync(join(ctx.dir, id), { recursive: true });
    const target = join(ctx.dir, id, 'base.tar.gz.enc');
    await encryptFile(join(tmp, 'base.tar.gz'), target, key);
    rmSync(tmp, { recursive: true, force: true });
    const sha = await sha256File(target);
    await withDb(ctx, (db) =>
      backups.update(db, id, {
        status: 'completed',
        sha256: sha,
        sizeBytes: statSync(target).size,
        walStartLsn: walStart,
        walEndLsn: walEnd,
        completedAt: new Date(),
      }),
    );
    return id;
  } catch (error) {
    await withDb(ctx, (db) =>
      backups.update(db, id, { status: 'failed', report: { error: String(error) } }),
    );
    throw error;
  }
}

export interface DrillResult {
  backupId: string;
  rtoMs: number;
  ok: boolean;
  invariants?: unknown;
  error?: string;
  log?: string[];
  /** Клон оставлен работать (`--keep`): адрес для `PERSIST_RESTORE_SOURCE_URL` (пароль скрыт). */
  cloneUrl?: string;
  container?: string;
}

/** Учебное восстановление: снимок и хвост WAL во временный экземпляр, инварианты, RTO. */
export async function drill(
  ctx: Ctx,
  backupId?: string,
  target?: string,
  rtoLimitMs = 900_000,
  keep = false,
): Promise<DrillResult> {
  const started = Date.now();
  const row = await withDb(ctx, async (db) =>
    backupId ? backups.get(db, backupId) : backups.latestUsable(db),
  );
  if (!row) throw new Error('нет снимка для проверки');
  const tmp = mkdtempSync(join(tmpdir(), 'dm-drill-'));
  const name = `duskmarch-restore-${row.id.slice(0, 8)}`;
  const finish = async (outcome: Omit<DrillResult, 'backupId' | 'rtoMs'>): Promise<DrillResult> => {
    let result = outcome;
    const rtoMs = Date.now() - started;
    const ok = result.ok && rtoMs <= rtoLimitMs;
    if (!ok) {
      const logs = spawnSync('docker', ['logs', '--tail', '20', name], { encoding: 'utf8' });
      result = { ...result, log: `${logs.stdout}${logs.stderr}`.split('\n').slice(-20) };
    }
    if (!(keep && ok)) {
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      rmSync(tmp, { recursive: true, force: true });
    }
    await withDb(ctx, (db) =>
      backups.update(db, row.id, {
        status: ok ? 'verified' : 'failed',
        verifiedAt: new Date(),
        report: { ...result, rtoMs, target: target ?? null },
      }),
    );
    return { backupId: row.id, rtoMs, ...result, ok };
  };
  try {
    const file = join(row.location, 'base.tar.gz.enc');
    if (row.sha256 && (await sha256File(file)) !== row.sha256)
      return await finish({ ok: false, error: 'контрольная сумма не совпадает' });
    await decryptFile(file, join(tmp, 'base.tar.gz'), keyOf(ctx).key);
    const data = join(tmp, 'data');
    const wal = join(tmp, 'wal');
    mkdirSync(data);
    mkdirSync(wal);
    execFileSync('tar', ['-xzf', join(tmp, 'base.tar.gz'), '-C', data]);
    chmodSync(data, 0o700);
    docker(['cp', `${ctx.container}:/wal-archive/.`, wal]);
    writeFileSync(join(data, 'recovery.signal'), '');
    appendFileSync(join(data, 'postgresql.auto.conf'), `\n${recoveryConf(target)}\n`);
    const uid = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--user',
      uid,
      '-v',
      `${data}:/var/lib/postgresql/data`,
      '-v',
      `${wal}:/wal:ro`,
      '-p',
      '127.0.0.1::5432',
      'postgres:17.2-alpine',
    ]);
    const port = docker(['port', name, '5432/tcp']).split(':').at(-1);
    const url = new URL(ctx.databaseUrl);
    url.port = port ?? '';
    for (;;) {
      const ready = spawnSync('docker', [
        'exec',
        '-e',
        `PGUSER=${ctx.user}`,
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-q',
      ]);
      if (ready.status === 0) {
        const r = spawnSync(
          'docker',
          [
            'exec',
            '-e',
            `PGPASSWORD=${ctx.password}`,
            name,
            'psql',
            '-h',
            '127.0.0.1',
            '-U',
            ctx.user,
            '-d',
            'duskmarch_dev',
            '-Atc',
            'select pg_is_in_recovery()',
          ],
          { encoding: 'utf8' },
        );
        if (r.stdout.trim() === 'f') break;
      }
      const state = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
        encoding: 'utf8',
      });
      if (state.stdout.trim() === 'false')
        return await finish({ ok: false, error: 'экземпляр завершился при восстановлении' });
      if (Date.now() - started > rtoLimitMs)
        return await finish({ ok: false, error: 'экземпляр не поднялся в срок' });
      await new Promise((r) => setTimeout(r, 300));
    }
    const client = createDbClient(url.href);
    try {
      const invariants = await checkWorldInvariants(client.db);
      return await finish({
        ok: invariants.ok,
        invariants,
        ...(keep ? { cloneUrl: url.href.replace(/:[^:@/]+@/, ':***@'), container: name } : {}),
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    return finish({ ok: false, error: String(error) });
  }
}

/** Именованная точка восстановления. */
export async function restorePoint(
  ctx: Ctx,
  shardId: string,
  name: string,
  reason: string,
  actor: string,
): Promise<string> {
  const lsn = psql(ctx, `select pg_create_restore_point('${name.replace(/[^a-z0-9._-]/gi, '')}')`);
  await withDb(ctx, (db) =>
    insertRestorePoint(db, {
      shardId,
      name,
      lsn,
      checkpointSeq: 0,
      createdBy: actor,
      reason,
      createdAt: new Date(),
    }),
  );
  return lsn;
}

/** Ротация: истёкшие снимки удаляются из хранилища, запись — `expired`. */
export async function prune(ctx: Ctx, now = new Date()): Promise<number> {
  return withDb(ctx, async (db) => {
    const old = await backups.expired(db, now);
    for (const row of old) {
      rmSync(row.location, { recursive: true, force: true });
      await backups.update(db, row.id, { status: 'expired' });
    }
    return old.length;
  });
}

async function main(argv: string[]): Promise<void> {
  const ctx = context(resolve(import.meta.dirname, '..'));
  const [command, ...rest] = argv;
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (command === 'snapshot')
    console.log(
      JSON.stringify({
        backupId: await snapshot(ctx, (rest[0] as BackupKind | undefined) ?? 'adhoc'),
      }),
    );
  else if (command === 'drill')
    console.log(
      JSON.stringify(
        await drill(ctx, flag('backup'), flag('target'), undefined, rest.includes('--keep')),
      ),
    );
  else if (command === 'restore-point')
    console.log(
      JSON.stringify({
        lsn: await restorePoint(
          ctx,
          flag('shard') ?? 'local-dev',
          rest[0] ?? '',
          flag('reason') ?? '',
          flag('actor') ?? '',
        ),
      }),
    );
  else if (command === 'prune') console.log(JSON.stringify({ expired: await prune(ctx) }));
  else {
    console.error(
      'usage: backup snapshot [kind] | drill [--backup id] [--target iso] | restore-point <name> --reason r --actor uuid | prune',
    );
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = 1;
  });
}
