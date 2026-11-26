import { DomainError } from '../errors/index.js';
import { MAX_SEQ, makeEntityId, type EphemeralId } from './entity-id.js';

/** Временные идентификаторы предпросмотра на клиенте; сервер их не принимает. */
export class EphemeralIdAllocator {
  private seq = 0;

  next(): EphemeralId {
    if (this.seq >= MAX_SEQ) throw new DomainError('ERR_ENTITY_ID_EXHAUSTED', 'маркеры исчерпаны');
    return makeEntityId('ephemeral', ++this.seq);
  }
}
