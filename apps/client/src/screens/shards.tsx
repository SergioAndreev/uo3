import { Button, Notice, Panel, Skeleton } from '@duskmarch/ui-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../services.js';

export interface ShardSummary {
  id: string;
  name: string;
  region: string;
  realms: { key: string; name: string; pvp: string }[];
  characterSlots: number;
  status: string;
  load: string;
  onlineCount: number | null;
  myCharacters?: number;
  canEnter?: boolean;
  entryBlockedReason?: string;
  assetPack?: { id: string; minVersion: string };
  staffOnly?: boolean;
}

interface ShardCard extends ShardSummary {
  rules: {
    preset: string;
    caps: { statTotal: number; skillTotalTenths: number };
    gameHourMs: number;
    creationOpen: boolean;
  };
  maintenance: { etaAt: string | null; message: string | null } | null;
}

export const POLL_MS = 15_000;
export const MANUAL_COOLDOWN_MS = 3_000;

const LOAD: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
  full: 'заполнен',
};
const BLOCKED: Record<string, string> = {
  SHARD_OFFLINE: 'Шард недоступен',
  SHARD_FULL: 'Шард заполнен',
  SHARD_MAINTENANCE: 'Идёт обслуживание',
  SHARD_DRAINING: 'Шард перезапускается',
  SHARD_PROTOCOL_INCOMPATIBLE: 'Нужна новая версия клиента',
};

const cmp = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** Совместимость активного пакета с требованием шарда. */
export function packCompatible(
  active: { id: string; version: string } | null,
  need?: { id: string; minVersion: string },
): boolean {
  if (!need) return true;
  return !!active && active.id === need.id && cmp(active.version, need.minVersion) >= 0;
}

const pageVisibility = {
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  subscribe: (l: () => void) => {
    document.addEventListener('visibilitychange', l);
    return () => document.removeEventListener('visibilitychange', l);
  },
};

/** Каталог шардов: опрос с `ETag`, ручное обновление, подробности, допуск. */
export function ShardsScreen() {
  const {
    api,
    assets,
    visibility = pageVisibility,
    now = Date.now,
    pollMs = POLL_MS,
  } = useServices();
  const navigate = useNavigate();
  const [shards, setShards] = useState<ShardSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<ShardCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cooldownUntil = useRef(0);
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<ShardSummary[]>(
        '/api/v1/shards',
        etag.current ? { headers: { 'if-none-match': etag.current } } : {},
      );
      etag.current = r.headers.get('etag') ?? etag.current;
      if (r.status !== 304 && r.data) setShards(r.data);
      setError(null);
    } catch {
      setError('Не удалось обновить список шардов');
    }
  }, [api]);

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (timer) clearInterval(timer);
      timer = visibility.visible() ? setInterval(() => void load(), pollMs) : null;
    };
    arm();
    const off = visibility.subscribe(() => {
      arm();
      if (visibility.visible()) void load();
    });
    return () => {
      off();
      if (timer) clearInterval(timer);
    };
  }, [load, visibility, pollMs]);

  useEffect(() => {
    if (!selected) return;
    void api.get<ShardCard>(`/api/v1/shards/${encodeURIComponent(selected)}`).then(
      (r) => setCard(r.data),
      () => setCard(null),
    );
  }, [api, selected]);

  const refresh = () => {
    if (now() < cooldownUntil.current) return;
    cooldownUntil.current = now() + MANUAL_COOLDOWN_MS;
    void load();
  };

  if (!shards) return error ? <Notice tone="error">{error}</Notice> : <Skeleton lines={4} />;
  const active = assets?.active() ?? null;
  return (
    <Panel title="Шарды">
      {error && <Notice tone="warning">{error}</Notice>}
      <Button variant="ghost" onClick={refresh}>
        Обновить
      </Button>
      <ul data-testid="shard-list">
        {shards.map((s) => (
          <li key={s.id} data-shard={s.id} aria-selected={s.id === selected}>
            <button type="button" onClick={() => setSelected(s.id)}>
              {s.name}
            </button>{' '}
            {s.staffOnly && <span data-testid="staff-only">Только персонал</span>} {s.region} ·{' '}
            {s.realms.map((r) => `${r.name} (${r.pvp})`).join(', ')} · {s.status} · загрузка{' '}
            {LOAD[s.load] ?? s.load} · онлайн {s.onlineCount ?? '—'} · героев {s.myCharacters ?? 0}/
            {s.characterSlots}
          </li>
        ))}
      </ul>
      {card && card.id === selected && (
        <ShardDetails
          card={card}
          active={active}
          onEnter={() => void navigate(`/shards/${encodeURIComponent(card.id)}/characters`)}
        />
      )}
    </Panel>
  );
}

function ShardDetails({
  card,
  active,
  onEnter,
}: {
  card: ShardCard;
  active: { id: string; version: string } | null;
  onEnter: () => void;
}) {
  const blocked =
    card.canEnter === false
      ? (BLOCKED[card.entryBlockedReason ?? ''] ?? card.entryBlockedReason ?? 'Вход закрыт')
      : null;
  const packOk = packCompatible(active, card.assetPack);
  return (
    <section data-testid="shard-details">
      <h3>{card.name}</h3>
      <p data-testid="rules">
        Кап характеристик {card.rules.caps.statTotal} · кап навыков{' '}
        {(card.rules.caps.skillTotalTenths / 10).toFixed(1)} · игровой час —{' '}
        {Math.round(card.rules.gameHourMs / 60_000)} мин · планы:{' '}
        {card.realms.map((r) => r.name).join(', ')}
      </p>
      {card.maintenance && (
        <Notice tone="warning">
          {card.maintenance.message ?? 'Обслуживание'}
          {card.maintenance.etaAt && (
            <> · до {new Date(card.maintenance.etaAt).toLocaleString('ru-RU')}</>
          )}
        </Notice>
      )}
      {blocked && <Notice tone="warning">{blocked}</Notice>}
      {!blocked && card.status !== 'online' && card.canEnter && <Notice>Служебный допуск</Notice>}
      {!packOk && card.assetPack && (
        <Notice tone="warning">
          Нужен пакет ассетов {card.assetPack.id} не ниже {card.assetPack.minVersion}.{' '}
          <a href={`/assets?returnTo=${encodeURIComponent(`/shards/${card.id}/characters`)}`}>
            Обновить пакет
          </a>
        </Notice>
      )}
      <Button onClick={onEnter} disabled={!!blocked || !packOk}>
        К героям
      </Button>
    </section>
  );
}
