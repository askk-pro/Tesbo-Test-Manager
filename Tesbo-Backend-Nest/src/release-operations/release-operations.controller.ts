import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { AuthenticatedRequest } from "../common/request.types";
import { ReleaseOperationsService } from "./release-operations.service";

@Controller()
export class ReleaseOperationsController {
  constructor(private readonly releases: ReleaseOperationsService) {}

  @Get("/api/projects/:projectId/release-environments")
  listEnvironments(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.releases.listEnvironments(req.userId, projectId);
  }

  @Post("/api/projects/:projectId/release-environments")
  createEnvironment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.releases.createEnvironment(req.userId, projectId, body || {});
  }

  @Patch("/api/projects/:projectId/release-environments/:environmentId")
  updateEnvironment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.releases.updateEnvironment(req.userId, projectId, environmentId, body || {});
  }

  @Delete("/api/projects/:projectId/release-environments/:environmentId")
  archiveEnvironment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
  ) {
    return this.releases.archiveEnvironment(req.userId, projectId, environmentId);
  }

  @Get("/api/projects/:projectId/release-promotions")
  listPromotions(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("limit") limit?: string,
  ) {
    return this.releases.listPromotions(req.userId, projectId, Number(limit || 100));
  }

  @Post("/api/projects/:projectId/release-promotions")
  createPromotion(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.releases.createPromotion(req.userId, projectId, body || {});
  }

  @Get("/api/projects/:projectId/release-promotions/:promotionId")
  getPromotion(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("promotionId") promotionId: string,
  ) {
    return this.releases.getPromotion(req.userId, projectId, promotionId);
  }

  @Post("/api/projects/:projectId/release-promotions/:promotionId/refresh")
  refreshPromotion(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("promotionId") promotionId: string,
  ) {
    return this.releases.refreshPromotion(req.userId, projectId, promotionId);
  }

  @Post("/api/projects/:projectId/release-promotions/:promotionId/decision")
  decidePromotion(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("promotionId") promotionId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.releases.decidePromotion(req.userId, projectId, promotionId, body || {});
  }
}
