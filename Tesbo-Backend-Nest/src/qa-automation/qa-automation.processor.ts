import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import {
  QA_AUTOMATION_PROCESSOR_CONCURRENCY,
  QA_AUTOMATION_QUEUE,
  QA_AUTOMATION_RUN_JOB,
  QA_AUTOMATION_TICK_JOB,
  QA_AUTOMATION_WATCHDOG_JOB,
} from "./qa-automation.constants";
import { QaAutomationService } from "./qa-automation.service";

@Processor(QA_AUTOMATION_QUEUE, { concurrency: QA_AUTOMATION_PROCESSOR_CONCURRENCY })
export class QaAutomationProcessor extends WorkerHost {
  private readonly logger = new Logger(QaAutomationProcessor.name);
  constructor(private readonly automation: QaAutomationService) { super(); }

  async process(job: Job): Promise<unknown> {
    if (job.name === QA_AUTOMATION_TICK_JOB) {
      const [schedules, events, requeued] = await Promise.all([
        this.automation.dispatchDueSchedules(),
        this.automation.dispatchOutboxEvents(),
        this.automation.requeueOrphanedAutomationRuns(),
      ]);
      return { schedules, events, requeued };
    }
    if (job.name === QA_AUTOMATION_RUN_JOB) {
      return this.automation.orchestrateRun(String(job.data?.automationRunId || ""));
    }
    if (job.name === QA_AUTOMATION_WATCHDOG_JOB) return this.automation.watchdog();
    this.logger.warn(`Unknown qa-automation job name: ${job.name}`);
    return null;
  }
}
