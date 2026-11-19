import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClientApp, parseClientRuntimeConfig } from "./App.js";

const config = parseClientRuntimeConfig(import.meta.env as Record<string, unknown>);
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ClientApp config={config} />
    </StrictMode>,
  );
}
