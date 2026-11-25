import { ApiEnvSchema, loadServerConfigOrExit, redactConfig } from '@duskmarch/config/env/server';

const config = loadServerConfigOrExit(ApiEnvSchema);
console.log(JSON.stringify({ msg: 'api: конфигурация', ...redactConfig(ApiEnvSchema, config) }));

// Фреймворк загружается только после проверки конфигурации.
const { createApp } = await import('./create-app.js');
const app = await createApp(config);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS).unref();
  });
}
await app.listen(config.API_PORT, config.API_HOST);
console.log(JSON.stringify({ msg: 'api: запущен', port: config.API_PORT }));
