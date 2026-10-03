import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import {
  RELEASE_DEPLOYMENT_MONITOR_JOB,
  RELEASE_VERIFICATION_MONITOR_JOB,
  RELEASE_OBSERVATION_MONITOR_JOB,
  RELEASE_DEPLOYMENT_PROCESSOR_CONCURRENCY,
  RELEASE_DEPLOYMENT_QUEUE,
} from "./release-deployment.constants";
import { ReleaseOperationsService } from "./release-operations.service";

@Processor(RELEASE_DEPLOYMENT_QUEUE, { concurrency: RELEASE_DEPLOYMENT_PROCESSOR_CONCURRENCY })
export class ReleaseDeploymentProcessor extends WorkerHost {
  private readonly logger = new Logger(ReleaseDeploymentProcessor.name);

  constructor(private readonly releases: ReleaseOperationsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const promotionId = String(job.data?.promotionId || "");
    if (!promotionId) return null;

    const maxAttempts = Math.max(1, Number(job.opts.attempts || 1));

    if (job.name === RELEASE_OBSERVATION_MONITOR_JOB) {
      try {
        const result = await this.releases.monitorObservation(promotionId);
        if (result.status === "pending") {
          if (job.attemptsMade + 1 >= maxAttempts) {
            return this.releases.failObservationTimeout(
              promotionId,
              "Release observation did not reach a terminal state before its monitoring allowance expired.",
            );
          }
          throw new Error("release_observation_pending");
        }
        return result;
      } catch (error) {
        if (job.attemptsMade + 1 >= maxAttempts) {
          return this.releases.failObservationTimeout(
            promotionId,
            "Release observation monitoring failed repeatedly: " +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        throw error;
      }
    }

    if (job.name === RELEASE_VERIFICATION_MONITOR_JOB) {
      try {
        const result = await this.releases.monitorVerification(promotionId);
        if (result.status === "pending") {
          if (job.attemptsMade + 1 >= maxAttempts) {
            return this.releases.failVerificationTimeout(
              promotionId,
              "Post-deployment verification did not reach a terminal Phase-6 state before the monitoring window expired.",
            );
          }
          throw new Error("release_verification_pending");
        }
        return result;
      } catch (error) {
        if (job.attemptsMade + 1 >= maxAttempts) {
          return this.releases.failVerificationTimeout(
            promotionId,
            "Post-deployment verification monitoring failed repeatedly: " +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        throw error;
      }
    }

    if (job.name !== RELEASE_DEPLOYMENT_MONITOR_JOB) {
      this.logger.warn("Unknown release deployment job: " + job.name);
      return null;
    }

    try {
      const result = await this.releases.monitorDeployment(promotionId);
      if (result.status === "pending") {
        if (job.attemptsMade + 1 >= maxAttempts) {
          return this.releases.failDeploymentTimeout(
            promotionId,
            "Deployment provider did not reach a terminal state before the monitoring window expired.",
          );
        }
        throw new Error("release_deployment_pending");
      }
      return result;
    } catch (error) {
      if (job.attemptsMade + 1 >= maxAttempts) {
        return this.releases.failDeploymentTimeout(
          promotionId,
          "Deployment monitoring failed repeatedly: " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      throw error;
    }
  }
}
