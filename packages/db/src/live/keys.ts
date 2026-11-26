/** Ключи Valkey шардов и билетов (P05). Однонодовый Valkey: Lua обращается к ключам по именам. */
export const KEYS = {
  heartbeat: (shard: string, node: string) => `dm:shard:${shard}:hb:${node}`,
  heartbeatPattern: (shard: string) => `dm:shard:${shard}:hb:*`,
  nodes: (shard: string) => `dm:shard:${shard}:nodes`,
  partitions: (shard: string) => `dm:shard:${shard}:partitions`,
  hub: (shard: string) => `dm:shard:${shard}:hub`,
  session: (shard: string, account: string) => `dm:shard:${shard}:session:${account}`,
  reservations: (shard: string, room: string) => `dm:shard:${shard}:room:${room}:resv`,
  accountBundle: (shard: string, account: string) => `dm:shard:${shard}:acct-ticket:${account}`,
  ticket: (hash: string) => `dm:ticket:${hash}`,
  revoke: (scope: 'account' | 'char' | 'shard', id: string) => `dm:revoke:${scope}:${id}`,
} as const;

/** Heartbeat живёт 15 с, реестр партиций и хаб — 20 с. */
export const HEARTBEAT_TTL_MS = 15_000;
export const REGISTRY_TTL_MS = 20_000;
/** Эпоха отзыва переживает самый долгий билет (60 с). */
export const REVOKE_TTL_MS = 120_000;
