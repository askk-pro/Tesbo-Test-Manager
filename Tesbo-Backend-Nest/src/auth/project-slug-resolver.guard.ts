import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuthenticatedRequest } from "../common/request.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Converts the friendly project slug in /api/projects/:id|:projectId routes into the project's UUID
 * after Nest has matched the route, but before controller params and authorization/write guards run.
 *
 * Why this is a guard instead of AuthMiddleware:
 * AuthMiddleware is registered with forRoutes("*"). Nest/Express mounts that wildcard as a matched
 * middleware route, so inside it req.url is "/" and the consumed path lives in req.baseUrl/
 * req.originalUrl. Rewriting req.url there therefore cannot change the project param Nest parses for
 * the actual controller. A global guard runs after route matching, when req.params is authoritative,
 * and mutating that param is exactly what @Param() and later guards receive.
 */
@Injectable()
export class ProjectSlugResolverGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req?.params) return true;

    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (!path.startsWith("/api/projects/")) return true;

    const paramKey =
      typeof req.params.projectId === "string"
        ? "projectId"
        : typeof req.params.id === "string"
          ? "id"
          : null;
    if (!paramKey) return true;

    const identifier = String(req.params[paramKey] || "").trim();
    if (!identifier || identifier === "overview" || UUID_RE.test(identifier)) return true;

    let projectId: string | null = null;

    if (req.apiToken?.projectId) {
      const result = await this.db.query<{ id: string }>(
        "SELECT id FROM projects WHERE id = $1 AND slug = $2 AND archived_at IS NULL LIMIT 1",
        [req.apiToken.projectId, identifier]
      );
      projectId = result.rows[0]?.id || null;
    } else if (req.userId) {
      const result = await this.db.query<{ id: string }>(
        "SELECT p.id FROM projects p JOIN users u ON u.active_organization_id = p.organization_id " +
          "WHERE u.id = $1 AND p.slug = $2 AND p.archived_at IS NULL LIMIT 1",
        [req.userId, identifier]
      );
      projectId = result.rows[0]?.id || null;
    }

    // Keep "not found" behavior safe and uniform: services continue to receive a syntactically valid
    // UUID, so an unknown/mismatched slug produces their normal 404 instead of a Postgres UUID-cast 500.
    req.params[paramKey] = projectId || UNKNOWN_PROJECT_ID;
    return true;
  }
}
