/** Ошибки сетевого слоя: числовой код и признак повтора. */
export const NETCODE_ERRORS = {
  PROTO_VERSION_UNSUPPORTED: { code: 1001, retryable: false },
  PROTO_HANDSHAKE_TIMEOUT: { code: 1002, retryable: true },
  PROTO_HANDSHAKE_REQUIRED: { code: 1003, retryable: true },
  PROTO_WORLD_DATA_INCOMPATIBLE: { code: 1004, retryable: false },
  PROTO_WRONG_ROOM_TYPE: { code: 1005, retryable: false },
  PROTO_UNKNOWN_OPCODE: { code: 1006, retryable: false },
  PROTO_INVALID_PAYLOAD: { code: 1007, retryable: false },
  PROTO_FRAME_TOO_LARGE: { code: 1008, retryable: false },
  PROTO_MALFORMED_FLOOD: { code: 1009, retryable: false },
  PROTO_RATE_LIMIT_EXCEEDED: { code: 1010, retryable: false },
  CMD_RATE_LIMITED: { code: 2001, retryable: true },
  CMD_QUEUE_OVERFLOW: { code: 2002, retryable: true },
  CMD_HANDLER_UNAVAILABLE: { code: 2003, retryable: false },
  CMD_FORBIDDEN_ACCESS_LEVEL: { code: 2004, retryable: false },
  CMD_INVALID_ENTITY_STATE: { code: 2005, retryable: false },
  CMD_INTERNAL_ERROR: { code: 2006, retryable: true },
  CMD_WALK_WINDOW_EXCEEDED: { code: 2007, retryable: true },
  CMD_TARGET_NOT_FOUND: { code: 2008, retryable: false },
  NET_HEARTBEAT_TIMEOUT: { code: 3001, retryable: true },
  NET_SLOW_CONSUMER: { code: 3002, retryable: true },
} as const;
export type NetcodeErrorCode = keyof typeof NETCODE_ERRORS;
