import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asItemSerial,
  DEFAULT_LEASE_SIZE,
  EphemeralSerialAllocator,
  InMemorySerialLeaseProvider,
  ITEM_SERIAL_MAX,
  ITEM_SERIAL_MIN,
  MOBILE_SERIAL_MAX,
  MOBILE_SERIAL_MIN,
  MOBILE_WARN_80,
  MOBILE_WARN_95,
  NPC_MOBILE_POOL_MIN,
  SERIAL_SENTINEL,
  SerialAllocator,
  SerialRegistry,
  validateLeaseSize,
  type SerialCapacityWarningEvent,
  type SerialEntityKind,
  type SerialLeaseGrant,
  type SerialLeaseProvider,
} from "./index.js";

function expectDomainCode(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("domain/entity-identity — SerialAllocator, LeaseProvider, Registry & Ephemeral", () => {
  it("validates lease sizes [256..65536] and grants disjoint blocks to independent partitions", () => {
    expect(validateLeaseSize(256)).toBe(256);
    expect(validateLeaseSize(DEFAULT_LEASE_SIZE)).toBe(4096);
    expect(validateLeaseSize(65_536)).toBe(65_536);

    expectDomainCode(() => validateLeaseSize(128), DomainErrorCode.ERR_INVALID_LEASE_SIZE);
    expectDomainCode(() => validateLeaseSize(100_000), DomainErrorCode.ERR_INVALID_LEASE_SIZE);
    expectDomainCode(() => validateLeaseSize(4096.5), DomainErrorCode.ERR_INVALID_LEASE_SIZE);

    const provider = new InMemorySerialLeaseProvider();
    const p1 = provider.requestLease("item", 4096);
    const p2 = provider.requestLease("item", 4096);

    expect(p1.rangeStart).toBe(0x40000000);
    expect(p1.rangeEnd).toBe(0x40000fff);
    expect(p2.rangeStart).toBe(0x40001000);
    expect(p2.rangeEnd).toBe(0x40001fff);

    const alloc1 = new SerialAllocator({ leaseProvider: provider, leaseSize: 4096 });
    const alloc2 = new SerialAllocator({ leaseProvider: provider, leaseSize: 4096 });
    const firstFrom1 = alloc1.allocateItem();
    const firstFrom2 = alloc2.allocateItem();
    expect(firstFrom1).toBe(0x40002000);
    expect(firstFrom2).toBe(0x40003000);
  });

  it("allocates mobiles and items independently, supports narrowed NPC pool, and never reuses deleted serials", () => {
    const alloc = new SerialAllocator();
    expect(alloc.allocateMobile()).toBe(0x00000001);
    expect(alloc.allocateMobile()).toBe(0x00000002);
    expect(alloc.allocateItem()).toBe(0x40000000);
    expect(alloc.allocateItem()).toBe(0x40000001);

    // Narrowed NPC pool 0x20000000..0x3FFFFFFF
    const npcAlloc = new SerialAllocator({
      mobileMin: NPC_MOBILE_POOL_MIN,
      mobileMax: MOBILE_SERIAL_MAX,
    });
    expect(npcAlloc.allocateMobile()).toBe(0x20000000);
    expect(npcAlloc.allocateMobile()).toBe(0x20000001);

    // Delete 0x40000005 and confirm no reuse
    let lastItem = alloc.allocateItem();
    while (lastItem < 0x40000005) {
      lastItem = alloc.allocateItem();
    }
    expect(lastItem).toBe(0x40000005);
    alloc.markDeleted(lastItem);
    expect(alloc.isMarkedDeleted(lastItem)).toBe(true);

    const afterDelete = alloc.allocateItem();
    expect(afterDelete).toBeGreaterThanOrEqual(0x40000006);
    expect(afterDelete).not.toBe(0x40000005);
  });

  it("triggers prefetch at exact <= 20% remaining threshold (3277th allocation of 4096) and transitions seamlessly", () => {
    const provider = new InMemorySerialLeaseProvider();
    const prefetchEvents: Array<{
      kind: SerialEntityKind;
      remaining: number;
      issuedCount: number;
    }> = [];
    let issuedCount = 0;

    const alloc = new SerialAllocator({
      leaseProvider: provider,
      leaseSize: 4096,
      onPrefetchRequested(kind, remaining) {
        prefetchEvents.push({ kind, remaining, issuedCount: issuedCount + 1 });
      },
    });

    for (let i = 0; i < 4100; i += 1) {
      const s = alloc.allocateItem();
      issuedCount += 1;
      expect(s).toBe(ITEM_SERIAL_MIN + i);
    }

    expect(prefetchEvents).toHaveLength(1);
    expect(prefetchEvents[0]).toEqual({ kind: "item", remaining: 819, issuedCount: 3277 });
  });

  it("supports async lease prefetch handoff when initial lease is synchronous", async () => {
    const backing = new InMemorySerialLeaseProvider();
    let calls = 0;
    const asyncProvider: SerialLeaseProvider = {
      requestLease(kind, size): SerialLeaseGrant | Promise<SerialLeaseGrant> {
        calls += 1;
        if (calls === 1) {
          return backing.requestLease(kind, size);
        }
        return Promise.resolve(backing.requestLease(kind, size));
      },
    };

    const alloc = new SerialAllocator({ leaseProvider: asyncProvider, leaseSize: 256 });
    for (let i = 0; i < 210; i += 1) {
      alloc.allocateItem();
    }
    // Let microtask resolve prefetched async lease
    await Promise.resolve();
    for (let i = 210; i < 260; i += 1) {
      expect(alloc.allocateItem()).toBe(ITEM_SERIAL_MIN + i);
    }
    expect(calls).toBe(2);
  });

  it("hydrates from max(maxLoaded + 1, savedHwm) and exports deterministic snapshots", () => {
    // Leading saved HWM (unused tail after crash must not be reused)
    const allocA = new SerialAllocator({ leaseSize: 4096 });
    allocA.hydrate({ maxLoadedItem: 0x40000120, savedItemHwm: 0x40001000 });
    expect(allocA.allocateItem()).toBe(0x40001000);
    expect(allocA.snapshot().itemHighWaterMark).toBe(0x40002000);

    // Lagging saved HWM (loaded entity ahead of saved HWM)
    const allocB = new SerialAllocator({ leaseSize: 4096 });
    allocB.hydrate({ maxLoadedMobile: 0x00002500, savedMobileHwm: 0x00002000 });
    expect(allocB.allocateMobile()).toBe(0x00002501);
    expect(allocB.snapshot().mobileCursor).toBe(0x00002502);
  });

  it("emits one-shot 80% and 95% capacity warnings and blocks range overflow with ERR_SERIAL_RANGE_EXHAUSTED", () => {
    const warnings: SerialCapacityWarningEvent[] = [];
    const mobileAlloc = new SerialAllocator({
      leaseSize: 256,
      onCapacityWarning: (ev) => warnings.push(ev),
    });

    mobileAlloc.hydrate({ maxLoadedMobile: MOBILE_WARN_80 - 2 });
    expect(mobileAlloc.allocateMobile()).toBe(MOBILE_WARN_80 - 1);
    expect(warnings).toHaveLength(0);
    expect(mobileAlloc.allocateMobile()).toBe(MOBILE_WARN_80);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.thresholdPercent).toBe(80);
    // Repeated allocations do not re-emit 80%
    mobileAlloc.allocateMobile();
    expect(warnings).toHaveLength(1);

    mobileAlloc.hydrate({ maxLoadedMobile: MOBILE_WARN_95 - 1 });
    expect(mobileAlloc.allocateMobile()).toBe(MOBILE_WARN_95);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]?.thresholdPercent).toBe(95);

    // Exhaust mobile range right at 0x3FFFFFFF without overflowing into 0x40000000
    mobileAlloc.hydrate({ maxLoadedMobile: MOBILE_SERIAL_MAX - 1 });
    expect(mobileAlloc.allocateMobile()).toBe(MOBILE_SERIAL_MAX);
    expectDomainCode(
      () => mobileAlloc.allocateMobile(),
      DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED,
    );

    // Exhaust item range right at 0x7FFFFFFF without overflowing into 0x80000000
    const itemAlloc = new SerialAllocator({ leaseSize: 256 });
    itemAlloc.hydrate({ maxLoadedItem: ITEM_SERIAL_MAX - 1 });
    expect(itemAlloc.allocateItem()).toBe(ITEM_SERIAL_MAX);
    expectDomainCode(() => itemAlloc.allocateItem(), DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED);
  });

  it("enforces SerialRegistry collision detection and blocks reserved/ephemeral/null serials", () => {
    const registry = new SerialRegistry<{ name: string }>();
    const s = asItemSerial(0x40000042);

    registry.register(s, { name: "original" });
    expect(registry.size).toBe(1);
    expect(registry.has(s)).toBe(true);

    expectDomainCode(
      () => registry.register(s, { name: "duplicate" }),
      DomainErrorCode.ERR_SERIAL_COLLISION,
    );
    expect(registry.get(s)).toEqual({ name: "original" });

    expectDomainCode(
      () => registry.register(0x80000001, { name: "client-preview" }),
      DomainErrorCode.ERR_RESERVED_SERIAL,
    );
    expectDomainCode(
      () => registry.register(SERIAL_SENTINEL, { name: "sentinel" }),
      DomainErrorCode.ERR_RESERVED_SERIAL,
    );
    expectDomainCode(
      () => registry.register(0x00000000, { name: "null" }),
      DomainErrorCode.ERR_INVALID_SERIAL,
    );

    expect(registry.unregister(s)).toBe(true);
    expect(registry.size).toBe(0);
  });

  it("issues client-local ephemeral serials in 0x80000000..0xFFFFFFFE and never emits 0xFFFFFFFF", () => {
    const eph = new EphemeralSerialAllocator();
    expect(eph.peekNext()).toBe(0x80000000);
    expect(eph.allocate()).toBe(0x80000000);
    expect(eph.allocate()).toBe(0x80000001);

    const edge = new EphemeralSerialAllocator(0xfffffffe, 0xfffffffe);
    expect(edge.allocate()).toBe(0xfffffffe);
    expectDomainCode(() => edge.allocate(), DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED);

    expectDomainCode(
      () => new EphemeralSerialAllocator(0x7fffffff),
      DomainErrorCode.ERR_INVALID_SERIAL,
    );
  });

  it("allocates 100,000 mobiles and 100,000 items across two partitions with 0 duplicates", () => {
    const sharedProvider = new InMemorySerialLeaseProvider();
    const partA = new SerialAllocator({ leaseProvider: sharedProvider, leaseSize: 4096 });
    const partB = new SerialAllocator({ leaseProvider: sharedProvider, leaseSize: 4096 });

    const mobiles = new Set<number>();
    const items = new Set<number>();

    let prevMobileA = MOBILE_SERIAL_MIN - 1;
    let prevItemA = ITEM_SERIAL_MIN - 1;
    for (let i = 0; i < 50_000; i += 1) {
      const mA = partA.allocateMobile();
      const mB = partB.allocateMobile();
      const itA = partA.allocateItem();
      const itB = partB.allocateItem();

      expect(mA).toBeGreaterThan(prevMobileA);
      expect(itA).toBeGreaterThan(prevItemA);
      prevMobileA = mA;
      prevItemA = itA;

      mobiles.add(mA);
      mobiles.add(mB);
      items.add(itA);
      items.add(itB);
    }

    expect(mobiles.size).toBe(100_000);
    expect(items.size).toBe(100_000);
  });
});
