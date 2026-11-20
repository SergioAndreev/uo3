import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  EPHEMERAL_SERIAL_MAX,
  EPHEMERAL_SERIAL_MIN,
  formatSerial,
  type EphemeralSerial,
} from "./serial.js";

export class EphemeralSerialAllocator {
  private cursor: number;
  private readonly max: number;

  public constructor(start = EPHEMERAL_SERIAL_MIN, max = EPHEMERAL_SERIAL_MAX) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(max) ||
      start < EPHEMERAL_SERIAL_MIN ||
      max > EPHEMERAL_SERIAL_MAX ||
      start > max
    ) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_SERIAL,
        `Ephemeral allocator bounds must be within 0x80000000..0xFFFFFFFE (received ${String(start)}..${String(max)})`,
        { details: { start, max } },
      );
    }
    this.cursor = start;
    this.max = max;
  }

  public allocate(): EphemeralSerial {
    if (this.cursor > this.max) {
      throw new DomainError(
        DomainErrorCode.ERR_SERIAL_RANGE_EXHAUSTED,
        `Ephemeral serial range exhausted at ${formatSerial(this.max)} (0xFFFFFFFF sentinel is never issued)`,
        { details: { max: this.max } },
      );
    }
    const issued = this.cursor as EphemeralSerial;
    this.cursor += 1;
    return issued;
  }

  public peekNext(): number {
    return this.cursor;
  }
}
