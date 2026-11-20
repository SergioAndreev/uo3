import { deepFreeze, type DeepReadonly } from "@uo3/domain";
import type { ResolvedRulesetProfile } from "../resolver/merge-and-validate.js";
import type { ClientRulesetSnapshot } from "../schema/ruleset.schema.js";

export function toClientRulesetSnapshot(
  profile: DeepReadonly<ResolvedRulesetProfile>,
): DeepReadonly<ClientRulesetSnapshot> {
  return deepFreeze<ClientRulesetSnapshot>({
    schemaVersion: profile.meta.schemaVersion,
    profileDigest: profile.profileDigest,
    era: profile.meta.era,
    presetId: profile.meta.presetId,
    features: { ...profile.features },
    geometry: { ...profile.geometry },
    network: { ...profile.network },
    movement: { ...profile.movement },
    time: { ...profile.time },
    character: {
      ...profile.character,
      enabledRaces: [...profile.character.enabledRaces],
    },
    inventory: { ...profile.inventory },
    pvp: { ...profile.pvp },
    speech: { ...profile.speech },
    lifecycle: { ...profile.lifecycle },
  });
}
