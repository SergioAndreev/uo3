/** Создаёт фабрику уникальных предсказуемых маркеров для тестов. */
export function createMarkerFactory(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}
