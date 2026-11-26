import { MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION } from '@duskmarch/protocol';
import { fingerprint, publicProfile, type Profile } from '@duskmarch/rules';
import type { NetContext } from './partition-net.js';

/** Контекст сетевого слоя шарда из профиля правил и версии мира. */
export function netContext(
  shardId: string,
  profile: Profile,
  worldVersion: string,
  log?: NetContext['log'],
  patchIds: readonly string[] = [],
): NetContext {
  return {
    shardId,
    handshake: {
      protocolVersion: PROTOCOL_VERSION,
      minSupportedProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
      rulesetFingerprint: fingerprint(profile),
      ruleset: publicProfile(profile),
      worldVersion,
      patchIds,
    },
    radius: profile.interest.radius,
    largeRadius: profile.interest.largeRadius,
    now: () => performance.now(),
    ...(log ? { log } : {}),
  };
}
