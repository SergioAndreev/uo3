import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PROTOCOL_VERSION } from "@uo3/protocol";
import { PACKAGE_ID as RULES_ID } from "@uo3/rules";
import { PACKAGE_ID as UO_FORMATS_ID } from "@uo3/uo-formats";
import type { GameReadinessProber } from "./game-server.module.js";

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

export function createHealthHttpServer(shardId: string, prober: GameReadinessProber): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/healthz") {
      sendJson(res, 200, {
        status: "ok",
        service: "@uo3/game-server",
        shardId,
        protocolVersion: PROTOCOL_VERSION,
        packages: [DOMAIN_ID, RULES_ID, UO_FORMATS_ID, CONTENT_ID],
      });
      return;
    }

    if (req.method === "GET" && urlPath === "/readyz") {
      prober
        .checkReadiness(450)
        .then((report) => {
          sendJson(res, report.ok ? 200 : 503, {
            status: report.status,
            shardId: report.shardId,
            dependencies: report.dependencies,
            latencyMs: report.latencyMs,
          });
        })
        .catch(() => {
          sendJson(res, 503, {
            status: "degraded",
            shardId,
            dependencies: { postgres: "down", valkey: "down", nats: "down" },
          });
        });
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });
}
