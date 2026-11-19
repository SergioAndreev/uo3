import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PROTOCOL_VERSION } from "@uo3/protocol";
import { PACKAGE_ID as RULES_ID } from "@uo3/rules";
import { READINESS_PROBER_TOKEN, type ReadinessProber } from "./infra.module.js";

export interface HttpResponseLike {
  status(code: number): { json(body: unknown): unknown };
}

@Controller()
export class HealthController {
  public constructor(@Inject(READINESS_PROBER_TOKEN) private readonly prober: ReadinessProber) {}

  @Get("/healthz")
  public getHealthz() {
    return {
      status: "ok",
      service: "@uo3/api",
      protocolVersion: PROTOCOL_VERSION,
      packages: [DOMAIN_ID, RULES_ID, CONTENT_ID],
    };
  }

  @Get("/readyz")
  public async getReadyz(@Res() res: HttpResponseLike) {
    const report = await this.prober.checkReadiness(450);
    const code = report.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(code).json({
      status: report.status,
      dependencies: report.dependencies,
      latencyMs: report.latencyMs,
    });
  }
}
