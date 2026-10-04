import { Body, Controller, Delete, Get, Param, Post, Req } from "@nestjs/common";

import { AuthenticatedRequest } from "../common/request.types";
import { EngineeringIntegrationsService } from "./engineering-integrations.service";

@Controller()
export class EngineeringIntegrationsController {
  constructor(private readonly integrations: EngineeringIntegrationsService) {}

  @Get("/api/workspace/engineering-integrations/:provider/status")
  workspaceStatus(@Req() req: AuthenticatedRequest, @Param("provider") provider: string) {
    return this.integrations.workspaceStatus(req.userId, provider);
  }

  @Post("/api/workspace/engineering-integrations/:provider/connect")
  connectWorkspace(
    @Req() req: AuthenticatedRequest,
    @Param("provider") provider: string,
    @Body() body: Record<string, any>,
  ) {
    return this.integrations.connectWorkspace(req.userId, provider, body);
  }

  @Delete("/api/workspace/engineering-integrations/:provider/disconnect")
  disconnectWorkspace(@Req() req: AuthenticatedRequest, @Param("provider") provider: string) {
    return this.integrations.disconnectWorkspace(req.userId, provider);
  }

  @Get("/api/projects/:projectId/azure-devops/status")
  azureStatus(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.projectStatus(req.userId, projectId, "azure-devops");
  }

  @Get("/api/projects/:projectId/azure-devops/projects")
  azureProjects(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.azureProjects(req.userId, projectId);
  }

  @Post("/api/projects/:projectId/azure-devops/project")
  mapAzureProject(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.integrations.mapAzureProject(req.userId, projectId, body);
  }

  @Post("/api/projects/:projectId/azure-devops/sync")
  syncAzure(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.syncAzure(req.userId, projectId);
  }

  @Get("/api/projects/:projectId/github/status")
  githubStatus(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.projectStatus(req.userId, projectId, "github");
  }

  @Get("/api/projects/:projectId/github/repositories")
  githubRepositories(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.githubRepositories(req.userId, projectId);
  }

  @Post("/api/projects/:projectId/github/repository")
  mapGithubRepository(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.integrations.mapGithubRepository(req.userId, projectId, body);
  }

  @Post("/api/projects/:projectId/github/sync")
  syncGithub(@Req() req: AuthenticatedRequest, @Param("projectId") projectId: string) {
    return this.integrations.syncGithub(req.userId, projectId);
  }
}
