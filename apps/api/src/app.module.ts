import { Module, type DynamicModule } from "@nestjs/common";
import { PlatformConfigModule, type ApiConfig } from "./config.module.js";
import { HealthController } from "./health.controller.js";
import { InfraConnectionsModule } from "./infra.module.js";

@Module({})
export class AppModule {
  public static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformConfigModule.forRoot(config), InfraConnectionsModule],
      controllers: [HealthController],
    };
  }
}
