import { Client } from 'colyseus.js';
import type { Connector, RoomLike } from './net-client.js';

/** Соединитель на `colyseus.js` для браузера и Node. */
export function colyseusConnector(endpoint: string): Connector {
  const client = new Client(endpoint);
  return {
    joinById: async <S>(roomId: string, options: Record<string, unknown>) =>
      (await client.joinById(roomId, options)) as unknown as RoomLike<S>,
  };
}
