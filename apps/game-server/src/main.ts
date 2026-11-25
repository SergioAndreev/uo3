import {
  GameServerEnvSchema,
  loadServerConfigOrExit,
  redactConfig,
} from '@duskmarch/config/env/server';

const config = loadServerConfigOrExit(GameServerEnvSchema);
const view = redactConfig(GameServerEnvSchema, config);
console.log(JSON.stringify({ msg: 'game-server: конфигурация', ...view }));

// Фреймворки загружаются только после проверки конфигурации.
const { startGameHost } = await import('./game-host.js');
const host = await startGameHost(config);
console.log(JSON.stringify({ msg: 'game-server: запущен', port: host.gamePort }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS).unref();
    void host.stop().then(() => process.exit(0));
  });
}
