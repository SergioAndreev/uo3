/** Блоки опкодов фаз (таблица 1 реестра протокола). */
export const PHASE_BLOCKS = {
  P07: [0x0001, 0x001f],
  P06: [0x0020, 0x003f],
  P12: [0x0100, 0x011f],
  P13: [0x0120, 0x014f],
  P14: [0x0150, 0x017f],
  P15: [0x0180, 0x019f],
  P16: [0x01a0, 0x01cf],
  P17: [0x01d0, 0x01ef],
  P18: [0x01f0, 0x021f],
  P19: [0x0220, 0x023f],
  P20: [0x0240, 0x025f],
  P21: [0x0260, 0x028f],
  P22: [0x0290, 0x02af],
  P23: [0x02b0, 0x02cf],
  P24: [0x02d0, 0x02df],
  P25: [0x02e0, 0x02ef],
  P26: [0x02f0, 0x031f],
  P27: [0x0320, 0x033f],
  P28: [0x0340, 0x035f],
  P29: [0x0360, 0x037f],
  P30: [0x0380, 0x038f],
  P31: [0x0390, 0x039f],
  P32: [0x03a0, 0x03bf],
  P33: [0x03c0, 0x03cf],
  P34: [0x03d0, 0x03df],
  P36: [0x03e0, 0x03ff],
} as const satisfies Record<string, readonly [number, number]>;
export type Phase = keyof typeof PHASE_BLOCKS;

/** Сетевые сообщения P07. */
export const NETCODE_OPCODES = {
  'session.hello': 0x0001,
  'session.welcome': 0x0002,
  'time.ping': 0x0003,
  'time.pong': 0x0004,
  'cmd.error': 0x0005,
  'aoi.resync_request': 0x0006,
  'aoi.resync': 0x0007,
  'event.batch': 0x0008,
} as const;
export type NetcodeMessage = keyof typeof NETCODE_OPCODES;

/** Версия протокола и минимальная поддерживаемая. */
export const PROTOCOL_VERSION = '1.0.0';
export const MIN_SUPPORTED_PROTOCOL_VERSION = '1.0.0';

/** Предел фрейма: обычные намерения и ответы панелей и команды персонала. */
export const MAX_FRAME_BYTES = 16_384;
export const MAX_LARGE_FRAME_BYTES = 65_536;
export const HANDSHAKE_TIMEOUT_MS = 5_000;
export const IDLE_TIMEOUT_MS = 30_000;

/** Коды закрытия сетевого слоя (реестр, таблица 2). */
export const NETCODE_CLOSE = {
  PROTOCOL_ERROR: 4100,
  WORLD_DATA_MISMATCH: 4107,
  RATE_LIMIT_EXCEEDED: 4108,
  PROTOCOL_VERSION_MISMATCH: 4111,
  HANDSHAKE_TIMEOUT: 4129,
  SLOW_CONSUMER: 4130,
  HEARTBEAT_TIMEOUT: 4131,
} as const;
