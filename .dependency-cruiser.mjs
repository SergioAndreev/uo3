const TEST = '\\.test\\.tsx?$';
const NODE_ONLY = ['core'];
const BROWSER = '^(apps/(client|admin)|packages/ui-kit)/src/';
const ISOMORPHIC = '^packages/(domain|rules|protocol|asset-formats|content|test-kit)/src/';
const SERVER = '^apps/(api|game-server|asset-tool|bot-client)/src/';

/** Матрица из design P00; должна совпадать с packages/README.md. */
export const LAYERS = {
  config: [],
  domain: [],
  rules: ['domain'],
  protocol: ['domain'],
  'asset-formats': ['domain'],
  content: ['domain', 'rules'],
  db: ['domain', 'config'],
  'ui-kit': ['domain', 'protocol', 'config'],
  'test-kit': ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'config'],
  client: ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'ui-kit', 'config'],
  admin: ['domain', 'protocol', 'content', 'ui-kit', 'config'],
  api: ['domain', 'rules', 'protocol', 'content', 'db', 'config'],
  'game-server': ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'db', 'config'],
  'asset-tool': ['domain', 'asset-formats', 'content', 'config'],
  'bot-client': ['domain', 'rules', 'protocol', 'config'],
};

const APPS = ['client', 'admin', 'api', 'game-server', 'asset-tool', 'bot-client'];
const layerRules = Object.entries(LAYERS).map(([name, allowed]) => ({
  name: `layer-${name}`,
  severity: 'error',
  from: { path: `^(apps|packages)/${name}/src/`, pathNot: TEST },
  to: { path: '^packages/', pathNot: `^packages/(${[name, 'test-kit', ...allowed].join('|')})/` },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    ...APPS.map((app) => ({
      name: `no-import-from-app-${app}`,
      severity: 'error',
      from: { pathNot: `^apps/${app}/` },
      to: { path: `^apps/${app}/` },
    })),
    {
      name: 'browser-no-server',
      severity: 'error',
      from: { path: BROWSER, pathNot: TEST },
      to: { path: '^packages/(db/|config/src/env/server)' },
    },
    {
      name: 'browser-no-node',
      severity: 'error',
      from: { path: BROWSER, pathNot: TEST },
      to: { dependencyTypes: NODE_ONLY },
    },
    {
      name: 'isomorphic-no-node',
      severity: 'error',
      from: { path: ISOMORPHIC, pathNot: TEST },
      to: { dependencyTypes: NODE_ONLY },
    },
    {
      name: 'server-no-browser-ui',
      severity: 'error',
      from: { path: SERVER },
      to: { path: '^packages/ui-kit/|node_modules/(react|react-dom|three)/' },
    },
    {
      name: 'bot-and-asset-tool-no-db',
      severity: 'error',
      from: { path: '^apps/(bot-client|asset-tool)/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'test-kit-only-in-tests',
      severity: 'error',
      from: { path: '^(apps|packages)/', pathNot: `${TEST}|^packages/test-kit/` },
      to: { path: '^packages/test-kit/' },
    },
    ...layerRules,
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.boundaries.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|reports)/|vitest\\.config\\.ts$' },
  },
};
