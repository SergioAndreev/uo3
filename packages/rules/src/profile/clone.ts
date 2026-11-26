/** Глубокая копия JSON-данных; `structuredClone` нет в изоморфных типах. */
export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
