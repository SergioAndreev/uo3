import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { AssetPackRequirement } from '../shards/schemas.js';
import {
  CONTROL_ACTIONS,
  ClientProfile,
  ClientProfilePatch,
  DEFAULT_BINDINGS,
  PROFILE_MAX_BYTES,
  RESERVED_CHORDS,
  applyPatch,
  bindingConflicts,
  defaultProfile,
  profileErrors,
} from './index.js';

describe('protocol/settings: профиль клиента', () => {
  it('профиль по умолчанию валиден, все действия назначены без конфликтов', () => {
    const p = defaultProfile();
    expect(Value.Check(ClientProfile, p)).toBe(true);
    expect(Object.keys(p.controls.bindings).sort()).toEqual([...CONTROL_ACTIONS].sort());
    expect(bindingConflicts(DEFAULT_BINDINGS)).toEqual({});
    for (const chord of Object.values(DEFAULT_BINDINGS))
      expect(RESERVED_CHORDS.has(chord)).toBe(false);
    expect(JSON.stringify(p).length).toBeLessThan(PROFILE_MAX_BYTES);
  });

  it('граничные значения принимаются; выход за границы и лишние поля — пути ошибок', () => {
    const p = defaultProfile();
    Object.assign(p.graphics, { cameraZoom: 0.5, occlusionRadiusCells: 12 });
    Object.assign(p.interface, { uiScale: 1.5, locale: 'ru' });
    p.audio.masterVolume = 0;
    expect(profileErrors(p)).toEqual([]);
    const bad = defaultProfile() as unknown as Record<string, Record<string, unknown>>;
    (bad['graphics'] as Record<string, unknown>)['cameraZoom'] = 3.5;
    (bad['audio'] as Record<string, unknown>)['masterVolume'] = 120;
    bad['injectedFlag'] = true as never;
    const errors = profileErrors(bad);
    expect(errors).toEqual(expect.arrayContaining(['/graphics/cameraZoom', '/audio/masterVolume']));
    expect(errors.length).toBeGreaterThanOrEqual(3);
    (bad['graphics'] as Record<string, unknown>)['cameraRotation'] = 45;
    expect(profileErrors(bad)).toContain('/graphics/cameraRotation');
  });

  it('правка: категории сливаются, привязки дополняются, конфликты находятся', () => {
    const p = defaultProfile();
    const patch = {
      expectedRevision: 3,
      changes: { audio: { masterVolume: 10 }, controls: { bindings: { 'panel.hero': 'KeyB' } } },
    };
    expect(Value.Check(ClientProfilePatch, patch)).toBe(true);
    const next = applyPatch(p, patch.changes as never);
    expect(next.audio).toMatchObject({ masterVolume: 10, musicVolume: 60 });
    expect(next.controls.bindings['panel.hero']).toBe('KeyB');
    expect(p.audio.masterVolume).toBe(80);
    expect(bindingConflicts(next.controls.bindings)).toEqual({
      KeyB: ['panel.hero', 'panel.pack'],
    });
    expect(
      Value.Check(ClientProfilePatch, { expectedRevision: 1, changes: { audio: { volume: 1 } } }),
    ).toBe(false);
  });

  it('требование пакета ассетов шарда', () => {
    expect(
      Value.Check(AssetPackRequirement, { id: 'pack.duskmarch-core', minVersion: '1.4.0' }),
    ).toBe(true);
    expect(Value.Check(AssetPackRequirement, { id: 'client-files', minVersion: '1' })).toBe(false);
  });
});
