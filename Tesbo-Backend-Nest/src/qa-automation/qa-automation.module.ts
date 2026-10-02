import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Logger, Module, OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { DatabaseModule } from "../database/database.module";
import { LegacyModule } from "../legacy/legacy.module";
import {
  QA_AUTOMATION_QUEUE,
  QA_AUTOMATION_TICK_INTERVAL_MS,
  QA_AUTOMATION_TICK_JOB,
  QA_AUTOMATION_TICK_SCHEDULER_ID,
  QA_AUTOMATION_WATCHDOG_INTERVAL_MS,
  QA_AUTOMATION_WATCHDOG_JOB,
  QA_AUTOMATION_WATCHDOG_SCHEDULER_ID,
} from "./qa-automation.constants";
import { QaAutomationController } from "./qa-automation.controller";
import { QaAutomationProcessor } from "./qa-automation.processor";
import { QaAutomationService } from "./qa-automation.service";

@Module({
  imports: [BullModule.registerQueue({ name: QA_AUTOMATION_QUEUE }), DatabaseModule, LegacyModule],
  controllers: [QaAutomationController],
  providers: [QaAutomationService, QaAutomationProcessor],
  exports: [QaAutomationService],
})
export class QaAutomationModule implements OnModuleInit {
  private readonly logger = new Logger(QaAutomationModule.name);
  constructor(@InjectQueue(QA_AUTOMATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      QA_AUTOMATION_TICK_SCHEDULER_ID,
      { every: QA_AUTOMATION_TICK_INTERVAL_MS },
      { name: QA_AUTOMATION_TICK_JOB, data: {} },
    ).then(() => this.logger.log("Continuous QA dispatcher registered (1 minute)."))
      .catch((error) => this.logger.warn(`Failed to register Continuous QA dispatcher: ${error instanceof Error ? error.message : error}`));

    await this.queue.upsertJobScheduler(
      QA_AUTOMATION_WATCHDOG_SCHEDULER_ID,
      { every: QA_AUTOMATION_WATCHDOG_INTERVAL_MS },
      { name: QA_AUTOMATION_WATCHDOG_JOB, data: {} },
    ).then(() => this.logger.log("Continuous QA watchdog registered (5 minutes)."))
      .catch((error) => this.logger.warn(`Failed to register Continuous QA watchdog: ${error instanceof Error ? error.message : error}`));
  }
}
