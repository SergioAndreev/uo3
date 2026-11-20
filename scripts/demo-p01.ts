import {
  computeGameTime,
  createPoint3D,
  createSeededRng,
  FACET_FELUCCA,
  formatSerial,
  getCoveringSectors,
  getDirectionBetween,
  InMemorySerialLeaseProvider,
  SerialAllocator,
  sha256Hex,
  stepPoint,
  type Direction,
} from "../packages/domain/dist/index.js";
import {
  calcBaseMaxHits,
  calcMaxCarryWeight,
  calcStepDelayMs,
  resolveRulesetProfile,
  toClientRulesetSnapshot,
} from "../packages/rules/dist/index.js";

export function buildP01DemoReport(): string {
  const profile = resolveRulesetProfile({ preset: "uor", environment: "production" });
  const clientSnapshot = toClientRulesetSnapshot(profile);

  // 1. Canonical UOR profile & ClientRulesetSnapshot
  const lines: string[] = [];
  lines.push("=== UO3 P01 Shared Domain Model & Rules Demo ===");
  lines.push(`Preset: ${profile.meta.presetId} (schema ${profile.meta.schemaVersion})`);
  lines.push(`Profile SHA-256 Digest: ${profile.profileDigest}`);
  lines.push(
    `Client Snapshot Keys: ${Object.keys(clientSnapshot).sort().join(", ")} (internal omitted: ${String(!("internal" in clientSnapshot))})`,
  );
  lines.push(
    `Canonical Formulas (STR=100): MaxHits=${calcBaseMaxHits(100)}, MaxCarryWeight=${calcMaxCarryWeight(100)}, RunMountedMs=${calcStepDelayMs(profile, { isMounted: true, isRunning: true })}`,
  );

  // 2. 24-hour UO game time, light curve & moon phases simulation
  lines.push("");
  lines.push("--- 24-Hour UO Game Day (Light Curve & Moons) ---");
  for (let hour = 0; hour < 24; hour += 3) {
    const elapsedRealMs = hour * profile.time.gameHourRealMs;
    const gt = computeGameTime(elapsedRealMs, { gameHourRealMs: profile.time.gameHourRealMs });
    lines.push(
      `Day ${gt.day} ${String(gt.hour).padStart(2, "0")}:${String(gt.minute).padStart(2, "0")} | Phase=${gt.dayPhase.padEnd(5)} | Darkness=${String(gt.globalLightLevel).padStart(2)}/26 | Trammel=${gt.trammelPhase} | Felucca=${gt.feluccaPhase}`,
    );
  }

  // 3. Deterministic allocation, movement, AOI sectors & forked RNG trace
  lines.push("");
  lines.push("--- Deterministic Allocation, Movement & Forked RNG Trace ---");
  const allocator = new SerialAllocator({ leaseProvider: new InMemorySerialLeaseProvider() });
  const rootRng = createSeededRng("uo3-p01-demo-seed");
  const moveRng = rootRng.fork("movement");
  const combatRng = rootRng.fork("combat");

  const hero = allocator.allocateMobile();
  const sword = allocator.allocateItem();
  let pos = createPoint3D(1420, 1690, 0);

  const traceEntries: string[] = [];
  for (let step = 0; step < 8; step++) {
    const dir = moveRng.nextInt(0, 7) as Direction;
    const nextPos = stepPoint(pos, dir);
    const heading = getDirectionBetween(pos, nextPos);
    const sectors = getCoveringSectors(nextPos, profile.network.aoiRadiusTiles, FACET_FELUCCA);
    const dmg = combatRng.rollDice(2, 6, 3);
    traceEntries.push(
      `step=${step} hero=${formatSerial(hero)} item=${formatSerial(sword)} pos=(${nextPos.x},${nextPos.y},${nextPos.z}) dir=${heading} aoiSectors=${sectors.length} dmg=${dmg}`,
    );
    pos = nextPos;
  }

  for (const entry of traceEntries) {
    lines.push(entry);
  }

  const body = lines.join("\n");
  const reportDigest = sha256Hex(body);
  return `${body}\n\nReport SHA-256: ${reportDigest}\n`;
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, "/").endsWith("scripts/demo-p01.ts");

if (isDirectRun) {
  process.stdout.write(buildP01DemoReport());
}
