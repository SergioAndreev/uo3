import type { ReactElement } from "react";
import { PROTOCOL_VERSION } from "@uo3/protocol";

export interface PlatformBadgeProps {
  readonly appName: string;
  readonly environment: string;
}

export function PlatformBadge({ appName, environment }: PlatformBadgeProps): ReactElement {
  return (
    <span data-testid="uo3-platform-badge" data-protocol={PROTOCOL_VERSION}>
      {appName} [{environment}]
    </span>
  );
}
