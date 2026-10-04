import { Module } from "@nestjs/common";

import { LegacyModule } from "../legacy/legacy.module";
import { EngineeringIntegrationsController } from "./engineering-integrations.controller";
import { EngineeringIntegrationsService } from "./engineering-integrations.service";

@Module({
  imports: [LegacyModule],
  controllers: [EngineeringIntegrationsController],
  providers: [EngineeringIntegrationsService],
})
export class EngineeringIntegrationsModule {}
