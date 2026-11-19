import type { ReactElement } from "react";
import { ClientEnvSchema, loadClientConfig, type ClientEnv } from "@uo3/config/env/client";
import type { DeepReadonly } from "@uo3/config/env/shared";
import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PROTOCOL_VERSION } from "@uo3/protocol";
import { PACKAGE_ID as RULES_ID } from "@uo3/rules";
import { PlatformBadge } from "@uo3/ui-kit";
import { PACKAGE_ID as UO_FORMATS_ID } from "@uo3/uo-formats";

export function parseClientRuntimeConfig(rawEnv: Record<string, unknown>): DeepReadonly<ClientEnv> {
  return loadClientConfig(ClientEnvSchema, rawEnv, "client");
}

export interface ClientAppProps {
  readonly config: DeepReadonly<ClientEnv>;
}

export function ClientApp({ config }: ClientAppProps): ReactElement {
  return (
    <main data-testid="uo3-client-shell" data-asset-mode={config.VITE_ASSET_MODE}>
      <h1>UO3 Client</h1>
      <PlatformBadge appName="UO3 Client" environment={config.VITE_APP_ENV} />
      <p data-testid="uo3-client-packages">
        {[DOMAIN_ID, RULES_ID, PROTOCOL_VERSION, UO_FORMATS_ID, CONTENT_ID].join(" | ")}
      </p>
    </main>
  );
}
