import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.types";
import { QaAutomationService } from "./qa-automation.service";

@Controller()
export class QaAutomationController {
  constructor(private readonly automation: QaAutomationService) {}

  private principalUserId(req: AuthenticatedRequest): string | null | undefined {
    return req.userId ?? req.apiToken?.userId ?? null;
  }

  private assertTokenScope(req: AuthenticatedRequest, projectId: string, required: "read" | "write") {
    const token = req.apiToken;
    if (!token) {
      if (!req.userId) throw new UnauthorizedException({ error: "Continuous QA requires a signed-in session or project API token" });
      return;
    }
    if (!token.projectId || token.projectId !== projectId) {
      throw new ForbiddenException({ error: "This API token is not scoped to this project" });
    }
    if (!token.scopes?.includes(required)) {
      throw new ForbiddenException({ error: `This call requires the "${required}" scope` });
    }
  }

  // Replaces the former 501 schedule stubs on the same routes.
  @Get("/api/projects/:projectId/cycles/schedules")
  schedules(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    this.assertTokenScope(req, projectId, "read");
    return this.automation.listSchedules(this.principalUserId(req), projectId);
  }

  @Post("/api/projects/:projectId/cycles/schedules")
  createSchedule(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Body() body: Record<string, any>) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.createSchedule(this.principalUserId(req), projectId, body || {});
  }

  @Patch("/api/cycles/schedules/:scheduleId")
  updateSchedule(@Req() req: AuthenticatedRequest, @Param("scheduleId") scheduleId: string, @Body() body: Record<string, any>) {
    if (!req.userId) throw new UnauthorizedException({ error: "Authentication required" });
    return this.automation.updateSchedule(req.userId, scheduleId, body || {});
  }

  @Delete("/api/cycles/schedules/:scheduleId")
  deleteSchedule(@Req() req: AuthenticatedRequest, @Param("scheduleId") scheduleId: string) {
    if (!req.userId) throw new UnauthorizedException({ error: "Authentication required" });
    return this.automation.deleteSchedule(req.userId, scheduleId);
  }

  @Post("/api/projects/:projectId/qa-automation/trigger")
  trigger(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Body() body: Record<string, any>) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.triggerManual(this.principalUserId(req), projectId, body || {});
  }

  @Get("/api/projects/:projectId/qa-automation/runs")
  runs(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Query("limit") limit?: string) {
    this.assertTokenScope(req, projectId, "read");
    return this.automation.listRuns(this.principalUserId(req), projectId, Number(limit || 100));
  }

  @Get("/api/projects/:projectId/qa-automation/runs/:runId")
  run(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("runId") runId: string) {
    this.assertTokenScope(req, projectId, "read");
    return this.automation.getRun(this.principalUserId(req), projectId, runId);
  }

  @Post("/api/projects/:projectId/qa-automation/workers/claim")
  claim(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Body() body: Record<string, any>) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.claimShard(this.principalUserId(req), projectId, body || {});
  }

  @Post("/api/projects/:projectId/qa-automation/shards/:shardId/heartbeat")
  heartbeat(
    @Req() req: AuthenticatedRequest, @Param("projectId") projectId: string,
    @Param("shardId") shardId: string, @Body() body: Record<string, any>,
  ) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.heartbeatShard(this.principalUserId(req), projectId, shardId, body || {});
  }

  @Post("/api/projects/:projectId/qa-automation/shards/:shardId/complete")
  complete(
    @Req() req: AuthenticatedRequest, @Param("projectId") projectId: string,
    @Param("shardId") shardId: string, @Body() body: Record<string, any>,
  ) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.completeShard(this.principalUserId(req), projectId, shardId, body || {});
  }

  @Get("/api/projects/:projectId/qa-automation/alerts")
  alerts(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Query("status") status?: string) {
    this.assertTokenScope(req, projectId, "read");
    return this.automation.listAlerts(this.principalUserId(req), projectId, status ?? "open");
  }

  @Post("/api/projects/:projectId/qa-automation/alerts/:alertId/acknowledge")
  acknowledge(
    @Req() req: AuthenticatedRequest, @Param("projectId") projectId: string, @Param("alertId") alertId: string,
  ) {
    this.assertTokenScope(req, projectId, "write");
    return this.automation.acknowledgeAlert(this.principalUserId(req), projectId, alertId);
  }

  @Get("/api/projects/:projectId/qa-automation/dashboard")
  dashboard(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    this.assertTokenScope(req, projectId, "read");
    return this.automation.dashboard(this.principalUserId(req), projectId);
  }
}
