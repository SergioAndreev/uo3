import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp, parseAdminRuntimeConfig } from "./App.js";

const config = parseAdminRuntimeConfig(import.meta.env as Record<string, unknown>);
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AdminApp config={config} />
    </StrictMode>,
  );
}
