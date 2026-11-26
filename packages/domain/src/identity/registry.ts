import { DomainError } from '../errors/index.js';
import { formatEntityId, kindOf, type EntityId } from './entity-id.js';

/** Активные сущности партиции; повторная регистрация — ошибка, запись не меняется. */
export class EntityRegistry<T> {
  private readonly entries = new Map<EntityId, T>();

  register(id: EntityId, value: T): void {
    const kind = kindOf(id);
    if (kind === undefined || kind === 'ephemeral') {
      throw new DomainError('ERR_RESERVED_ENTITY_ID', `${id >>> 0}: не сущность мира`);
    }
    if (this.entries.has(id)) {
      throw new DomainError('ERR_ENTITY_ID_COLLISION', `${formatEntityId(id)} уже зарегистрирован`);
    }
    this.entries.set(id, value);
  }

  get(id: EntityId): T | undefined {
    return this.entries.get(id);
  }

  remove(id: EntityId): boolean {
    return this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
