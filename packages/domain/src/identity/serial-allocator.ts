import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asSerial,
  formatSerial,
  isItemSerial,
  isMobileSerial,
  isReservedSerial,
  ITEM_SERIAL_MAX,
  ITEM_SERIAL_MIN,
  MOBILE_SERIAL_MAX,
  MOBILE_SERIAL_MIN,
  type EntitySerial,
  type ItemSerial,
  type MobileSerial,
} from "./serial.js";

export const MIN_LEASE_SIZE = 256;
export const MAX_LEASE_SIZE = 65_536;
export const DEFAULT_LEASE_SIZE = 4_096;
export const PREFETCH_THRESHOLD_RATIO = 0.2;

export const MOBILE_WARN_80 = 0x33333333;
export const MOBILE_WARN_95 = 0x3ccccccc;
export const ITEM_WARN_80 = 0x73333333;
export const ITEM_WARN_95 = 0x7ccccccc;

export type SerialEntityKind = "mobile" | "item";

export interface SerialLeaseGrant {
  readonly kind: SerialEntityKind;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly leaseId: string;
}

export interface SerialLeaseProvider {
  requestLease(kind: SerialEntityKind, size: number): SerialLeaseGrant | Promise<SerialLeaseGrant>;
  advanceHighWaterMark?(kind: SerialEntityKind, minNext: number): void | Promise<void>;
}

export interface SerialAllocatorSnapshot {
  readonly mobileCursor: number;
  readonly mobileHighWaterMark: number;
  readonly itemCursor: number;
  readonly itemHighWaterMark: number;
  readonly leaseSize: number;
}

export interface SerialCapacityWarningEvent {
  readonly kind: SerialEntityKind;
  readonly thresholdPercent: 80 | 95;
  readonly currentSerial: number;
  readonly remainingCapacity: number;
}

export interface SerialHydrationInput {
  readonly maxLoadedMobile?: number;
  readonly savedMobileHwm?: number;
  readonly maxLoadedItem?: number;
  readonly savedItemHwm?: number;
}

export interface InMemoryLeaseProviderOptions {
  readonly mobileMin?: number;
  readonly mobileMax?: number;
  readonly itemMin?: number;
  readonly itemMax?: number;
}

export interface SerialAllocatorOptions {
  readonly leaseProvider?: SerialLeaseProvider;
  readonly leaseSize?: number;
  readonly mobileMin?: number;
  readonly mobileMax?: number;
  readonly itemMin?: number;
  readonly itemMax?: number;
  readonly onCapacityWarning?: (event: SerialCapacityWarningEvent) => void;
  readonly onPrefetchRequested?: (kind: SerialEntityKind, remainingInLease: number) => void;
}

export function validateLeaseSize(size: number): number {
  if (!Number.isInteger(size) || size < MIN_LEASE_SIZE || size > MAX_LEASE_SIZE) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_LEASE_SIZE,
      `Lease size must be an integer in [${String(MIN_LEASE_SIZE)}, ${String(MAX_LEASE_SIZE)}], received ${String(size)}`,
      { fieldPath: "leaseSize", details: { size, min: MIN_LEASE_SIZE, max: MAX_LEASE_SIZE } },
    );
  }
  return size;
}

function validatePoolBounds(
  kind: SerialEntityKind,
  min: number,
  max: number,
  absoluteMin: number,
  absoluteMax: number,
): void {
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < absoluteMin ||
    max > absoluteMax ||
    min > max
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_SERIAL,
      `Invalid ${kind} pool bounds [${formatSerial(Math.max(0, Math.min(0xffffffff, Math.trunc(min))))}..${formatSerial(Math.max(0, Math.min(0xffffffff, Math.trunc(max))))}]`,
      { details: { kind, min, max, absoluteMin, absoluteMax } },
    );
  }
}

export class InMemorySerialLeaseProvider implements SerialLeaseProvider {
  private mobileNext: number;
  private readonly mobileMax: number;
  private itemNext: number;
  private readonly itemMax: number;
  private leaseSeq = 0;

  public constructor(options: InMemoryLeaseProviderOptions = {}) {
    const mobileMin = options.mobileMin ?? MOBILE_SERIAL_MIN;
    const mobileMax = options.mobileMax ?? MOBILE_SERIAL_MAX;
    const itemMin = options.itemMin ?? ITEM_SERIAL_MIN;
    const itemMax = options.itemMax ?? ITEM_SERIAL_MAX;

    validatePoolBounds("mobile", mobileMin, mobileMax, MOBILE_SERIAL_MIN, MOBILE_SERIAL_MAX);
    validatePoolBounds("item", itemMin, itemMax, ITEM_SERIAL_MIN, ITEM_SERIAL_MAX);

    this.mobileNext = mobileMin;
    this.mobileMax = mobileMax;
    this.itemNext = itemMin;
    this.itemMax = itemMax;
  }

  public requestLease(kind: SerialEntityKind, size: number): SerialLeaseGrant {
    validateLeaseSize(size);
    const current = kind === "mobile" ? this.mobileNext : this.itemNext;
    const poolMax = kind === "mobile" ? this.mobileMax : this.itemMax;

    if (current > poolMax) {
      throw new DomainError(
        DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED,
        `Serial range exhausted for ${kind} pool (max=${formatSerial(poolMax)})`,
        { details: { kind, poolMax } },
      );
    }

    const rangeStart = current;
    const rangeEnd = Math.min(poolMax, rangeStart + size - 1);
    if (kind === "mobile") {
      this.mobileNext = rangeEnd + 1;
    } else {
      this.itemNext = rangeEnd + 1;
    }
    this.leaseSeq += 1;

    return {
      kind,
      rangeStart,
      rangeEnd,
      leaseId: `lease-${kind}-${String(this.leaseSeq)}`,
    };
  }

  public advanceHighWaterMark(kind: SerialEntityKind, minNext: number): void {
    if (kind === "mobile") {
      if (minNext > this.mobileNext) {
        this.mobileNext = minNext;
      }
    } else if (minNext > this.itemNext) {
      this.itemNext = minNext;
    }
  }

  public getHighWaterMark(kind: SerialEntityKind): number {
    return kind === "mobile" ? this.mobileNext : this.itemNext;
  }
}

interface KindLeaseState {
  cursor: number;
  currentLease: SerialLeaseGrant | null;
  nextLease: SerialLeaseGrant | null;
  prefetchInFlight: boolean;
  highWaterMark: number;
  warned80: boolean;
  warned95: boolean;
  readonly poolMin: number;
  readonly poolMax: number;
  readonly warn80Threshold: number;
  readonly warn95Threshold: number;
}

export class SerialAllocator {
  private readonly provider: SerialLeaseProvider;
  private readonly leaseSize: number;
  private readonly prefetchWatermark: number;
  private readonly onCapacityWarning: ((event: SerialCapacityWarningEvent) => void) | undefined;
  private readonly onPrefetchRequested:
    ((kind: SerialEntityKind, remainingInLease: number) => void) | undefined;
  private readonly deletedSerials = new Set<number>();

  private readonly state: Record<SerialEntityKind, KindLeaseState>;

  public constructor(options: SerialAllocatorOptions = {}) {
    this.leaseSize = validateLeaseSize(options.leaseSize ?? DEFAULT_LEASE_SIZE);
    this.prefetchWatermark = Math.floor(this.leaseSize * PREFETCH_THRESHOLD_RATIO);
    this.onCapacityWarning = options.onCapacityWarning;
    this.onPrefetchRequested = options.onPrefetchRequested;

    const mobileMin = options.mobileMin ?? MOBILE_SERIAL_MIN;
    const mobileMax = options.mobileMax ?? MOBILE_SERIAL_MAX;
    const itemMin = options.itemMin ?? ITEM_SERIAL_MIN;
    const itemMax = options.itemMax ?? ITEM_SERIAL_MAX;

    validatePoolBounds("mobile", mobileMin, mobileMax, MOBILE_SERIAL_MIN, MOBILE_SERIAL_MAX);
    validatePoolBounds("item", itemMin, itemMax, ITEM_SERIAL_MIN, ITEM_SERIAL_MAX);

    this.provider =
      options.leaseProvider ??
      new InMemorySerialLeaseProvider({ mobileMin, mobileMax, itemMin, itemMax });

    this.state = {
      mobile: {
        cursor: mobileMin,
        currentLease: null,
        nextLease: null,
        prefetchInFlight: false,
        highWaterMark: mobileMin,
        warned80: false,
        warned95: false,
        poolMin: mobileMin,
        poolMax: mobileMax,
        warn80Threshold: MOBILE_WARN_80,
        warn95Threshold: MOBILE_WARN_95,
      },
      item: {
        cursor: itemMin,
        currentLease: null,
        nextLease: null,
        prefetchInFlight: false,
        highWaterMark: itemMin,
        warned80: false,
        warned95: false,
        poolMin: itemMin,
        poolMax: itemMax,
        warn80Threshold: ITEM_WARN_80,
        warn95Threshold: ITEM_WARN_95,
      },
    };
  }

  public allocateMobile(): MobileSerial {
    return this.allocate("mobile") as MobileSerial;
  }

  public allocateItem(): ItemSerial {
    return this.allocate("item") as ItemSerial;
  }

  public markDeleted(serial: EntitySerial): void {
    // Deleted serials are tracked only for diagnostics and NEVER returned to the allocation pool.
    this.deletedSerials.add(serial);
  }

  public isMarkedDeleted(serial: EntitySerial): boolean {
    return this.deletedSerials.has(serial);
  }

  public hydrate(input: SerialHydrationInput): void {
    if (input.maxLoadedMobile !== undefined || input.savedMobileHwm !== undefined) {
      this.hydrateKind("mobile", input.maxLoadedMobile, input.savedMobileHwm);
    }
    if (input.maxLoadedItem !== undefined || input.savedItemHwm !== undefined) {
      this.hydrateKind("item", input.maxLoadedItem, input.savedItemHwm);
    }
  }

  public snapshot(): SerialAllocatorSnapshot {
    return {
      mobileCursor: this.state.mobile.cursor,
      mobileHighWaterMark: this.state.mobile.highWaterMark,
      itemCursor: this.state.item.cursor,
      itemHighWaterMark: this.state.item.highWaterMark,
      leaseSize: this.leaseSize,
    };
  }

  private hydrateKind(
    kind: SerialEntityKind,
    maxLoaded: number | undefined,
    savedHwm: number | undefined,
  ): void {
    const bucket = this.state[kind];
    const fromLoaded = maxLoaded !== undefined ? maxLoaded + 1 : bucket.poolMin;
    const fromSaved = savedHwm ?? bucket.poolMin;
    const nextStart = Math.max(bucket.poolMin, fromLoaded, fromSaved);

    // Abandon any unused tail of prior leases — never reuse after crash/restart.
    bucket.currentLease = null;
    bucket.nextLease = null;
    bucket.prefetchInFlight = false;
    bucket.cursor = nextStart;
    bucket.highWaterMark = Math.max(bucket.highWaterMark, nextStart);

    const advanceResult = this.provider.advanceHighWaterMark?.(kind, nextStart);
    if (advanceResult && typeof (advanceResult as Promise<void>).then === "function") {
      void (advanceResult as Promise<void>).catch(() => undefined);
    }
  }

  private allocate(kind: SerialEntityKind): number {
    const bucket = this.state[kind];

    if (bucket.currentLease === null || bucket.cursor > bucket.currentLease.rangeEnd) {
      if (bucket.nextLease !== null) {
        bucket.currentLease = bucket.nextLease;
        bucket.nextLease = null;
        bucket.cursor = bucket.currentLease.rangeStart;
      } else {
        const grant = this.acquireSyncLease(kind);
        bucket.currentLease = grant;
        bucket.cursor = grant.rangeStart;
        bucket.highWaterMark = Math.max(bucket.highWaterMark, grant.rangeEnd + 1);
      }
    }

    if (bucket.cursor > bucket.poolMax || bucket.cursor > bucket.currentLease.rangeEnd) {
      throw new DomainError(
        DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED,
        `Serial range exhausted for ${kind} pool (max=${formatSerial(bucket.poolMax)})`,
        { details: { kind, poolMax: bucket.poolMax } },
      );
    }

    const issued = bucket.cursor;
    bucket.cursor += 1;
    bucket.highWaterMark = Math.max(bucket.highWaterMark, bucket.currentLease.rangeEnd + 1);

    this.checkCapacityWarnings(kind, bucket, issued);

    const remainingInLease = bucket.currentLease.rangeEnd - bucket.cursor + 1;
    if (
      remainingInLease <= this.prefetchWatermark &&
      bucket.nextLease === null &&
      !bucket.prefetchInFlight &&
      bucket.currentLease.rangeEnd < bucket.poolMax
    ) {
      this.triggerPrefetch(kind, bucket, remainingInLease);
    }

    return issued;
  }

  private acquireSyncLease(kind: SerialEntityKind): SerialLeaseGrant {
    const result = this.provider.requestLease(kind, this.leaseSize);
    if (typeof (result as Promise<SerialLeaseGrant>).then === "function") {
      throw new DomainError(
        DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED,
        `Asynchronous lease provider had no prefetched lease ready for ${kind}`,
        { details: { kind } },
      );
    }
    return result as SerialLeaseGrant;
  }

  private triggerPrefetch(
    kind: SerialEntityKind,
    bucket: KindLeaseState,
    remainingInLease: number,
  ): void {
    bucket.prefetchInFlight = true;
    this.onPrefetchRequested?.(kind, remainingInLease);
    try {
      const result = this.provider.requestLease(kind, this.leaseSize);
      if (typeof (result as Promise<SerialLeaseGrant>).then === "function") {
        void (result as Promise<SerialLeaseGrant>)
          .then((grant) => {
            bucket.nextLease = grant;
            bucket.highWaterMark = Math.max(bucket.highWaterMark, grant.rangeEnd + 1);
          })
          .catch(() => {
            // Next synchronous boundary will surface exhaustion cleanly if pool is full.
          })
          .finally(() => {
            bucket.prefetchInFlight = false;
          });
      } else {
        const grant = result as SerialLeaseGrant;
        bucket.nextLease = grant;
        bucket.highWaterMark = Math.max(bucket.highWaterMark, grant.rangeEnd + 1);
        bucket.prefetchInFlight = false;
      }
    } catch {
      bucket.prefetchInFlight = false;
    }
  }

  private checkCapacityWarnings(
    kind: SerialEntityKind,
    bucket: KindLeaseState,
    issued: number,
  ): void {
    if (!bucket.warned80 && issued >= bucket.warn80Threshold) {
      bucket.warned80 = true;
      this.onCapacityWarning?.({
        kind,
        thresholdPercent: 80,
        currentSerial: issued,
        remainingCapacity: bucket.poolMax - issued,
      });
    }
    if (!bucket.warned95 && issued >= bucket.warn95Threshold) {
      bucket.warned95 = true;
      this.onCapacityWarning?.({
        kind,
        thresholdPercent: 95,
        currentSerial: issued,
        remainingCapacity: bucket.poolMax - issued,
      });
    }
  }
}

export class SerialRegistry<T = unknown> {
  private readonly entries = new Map<EntitySerial, T>();

  public register(serial: number, entity: T): EntitySerial {
    const validated = asSerial(serial);
    if (isReservedSerial(validated)) {
      throw new DomainError(
        DomainErrorCode.ERR_RESERVED_SERIAL,
        `Reserved or ephemeral serial ${formatSerial(validated)} cannot be registered on server`,
        { details: { serial: validated } },
      );
    }
    if (!isMobileSerial(validated) && !isItemSerial(validated)) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_SERIAL,
        `Null serial ${formatSerial(validated)} cannot be registered as an active entity`,
        { details: { serial: validated } },
      );
    }
    if (this.entries.has(validated)) {
      throw new DomainError(
        DomainErrorCode.ERR_SERIAL_COLLISION,
        `Active entity collision for serial ${formatSerial(validated)}`,
        { details: { serial: validated } },
      );
    }
    this.entries.set(validated, entity);
    return validated;
  }

  public get(serial: EntitySerial): T | undefined {
    return this.entries.get(serial);
  }

  public has(serial: number): boolean {
    return this.entries.has(serial as EntitySerial);
  }

  public unregister(serial: EntitySerial): boolean {
    return this.entries.delete(serial);
  }

  public get size(): number {
    return this.entries.size;
  }
}
