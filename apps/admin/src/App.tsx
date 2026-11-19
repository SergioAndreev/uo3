import type { ReactElement } from "react";
import { AdminEnvSchema, loadClientConfig, type AdminEnv } from "@uo3/config/env/client";
import type { DeepReadonly } from "@uo3/config/env/shared";
import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PROTOCOL_VERSION } from "@uo3/protocol";
import { PlatformBadge } from "@uo3/ui-kit";

export function parseAdminRuntimeConfig(rawEnv: Record<string, unknown>): DeepReadonly<AdminEnv> {
  return loadClientConfig(AdminEnvSchema, rawEnv, "admin");
}

export function AdminApp({ config }: { readonly config: DeepReadonly<AdminEnv> }): ReactElement {
  return (
    <main data-testid="uo3-admin-shell">
      <h1>UO3 Admin Console</h1>
      <PlatformBadge appName="UO3 Admin" environment={config.VITE_APP_ENV} />
      <p>{[DOMAIN_ID, PROTOCOL_VERSION, CONTENT_ID].join(" | ")}</p>
    </main>
  );
}
