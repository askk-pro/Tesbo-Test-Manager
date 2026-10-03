import { BullModule } from "@nestjs/bullmq";
import { Logger, Module, OnModuleInit } from "@nestjs/common";
import { LegacyModule } from "../legacy/legacy.module";
import { QaAutomationModule } from "../qa-automation/qa-automation.module";
import { KpsDeploymentProvider } from "./kps-deployment.provider";
import { RELEASE_DEPLOYMENT_QUEUE } from "./release-deployment.constants";
import { ReleaseDeploymentProcessor } from "./release-deployment.processor";
import { ReleaseOperationsController } from "./release-operations.controller";
import { ReleaseOperationsService } from "./release-operations.service";

@Module({
  imports: [
    LegacyModule,
    QaAutomationModule,
    BullModule.registerQueue({ name: RELEASE_DEPLOYMENT_QUEUE }),
  ],
  controllers: [ReleaseOperationsController],
  providers: [
    ReleaseOperationsService,
    KpsDeploymentProvider,
    ReleaseDeploymentProcessor,
  ],
  exports: [ReleaseOperationsService],
})
export class ReleaseOperationsModule implements OnModuleInit {
  private readonly logger = new Logger(ReleaseOperationsModule.name);

  constructor(private readonly releases: ReleaseOperationsService) {}

  async onModuleInit(): Promise<void> {
    await this.releases.recoverDeploymentMonitors()
      .then((count) => {
        if (count > 0) this.logger.log("Recovered " + count + " release deployment monitor(s).");
      })
      .catch((error) => {
        this.logger.warn(
          "Failed to recover release deployment monitors: " +
            (error instanceof Error ? error.message : String(error)),
        );
      });
    await this.releases.recoverVerificationMonitors()
      .then((count) => {
        if (count > 0) this.logger.log("Recovered " + count + " release verification monitor(s).");
      })
      .catch((error) => {
        this.logger.warn(
          "Failed to recover release verification monitors: " +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  }
}
