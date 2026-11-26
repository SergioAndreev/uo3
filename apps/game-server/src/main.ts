import {
  GameServerEnvSchema,
  loadServerConfigOrExit,
  redactConfig,
} from '@duskmarch/config/env/server';

const config = loadServerConfigOrExit(GameServerEnvSchema);
const view = redactConfig(GameServerEnvSchema, config);
console.log(JSON.stringify({ msg: 'game-server: конфигурация', ...view }));

const { loadRuleset } = await import('./ruleset.js');
const ruleset = loadRuleset(config);
if (!ruleset.ok) {
  console.error(
    `Некорректный профиль правил шарда:\n${ruleset.errors.map((e) => `  - ${e}`).join('\n')}`,
  );
  process.exit(78);
}
console.log(
  JSON.stringify({
    msg: 'game-server: правила',
    preset: ruleset.profile.preset,
    fingerprint: ruleset.fingerprint,
  }),
);

const { loadWorld } = await import('./world.js');
const world = loadWorld(config);
if (!world.ok) {
  console.error(`Мир не загружен:\n${world.errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(78);
}
console.log(
  JSON.stringify({
    msg: 'game-server: мир',
    realm: world.store.realm.key,
    version: world.version,
    source: world.source,
  }),
);

// Фреймворки загружаются только после проверки конфигурации.
const { startGameHost } = await import('./game-host.js');
const host = await startGameHost(config, {
  realm: world.store.realm.key,
  version: world.version,
});
console.log(JSON.stringify({ msg: 'game-server: запущен', port: host.gamePort }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS).unref();
    void host.stop().then(() => process.exit(0));
  });
}
