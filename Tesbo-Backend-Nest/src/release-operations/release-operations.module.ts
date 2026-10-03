import { Module } from "@nestjs/common";
import { LegacyModule } from "../legacy/legacy.module";
import { ReleaseOperationsController } from "./release-operations.controller";
import { ReleaseOperationsService } from "./release-operations.service";

@Module({
  imports: [LegacyModule],
  controllers: [ReleaseOperationsController],
  providers: [ReleaseOperationsService],
  exports: [ReleaseOperationsService],
})
export class ReleaseOperationsModule {}
