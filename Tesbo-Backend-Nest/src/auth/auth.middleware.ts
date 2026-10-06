import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Response, NextFunction } from "express";
import { AppConfigService } from "../config/app-config.service";
import { AuthenticatedRequest } from "../common/request.types";
import { ApiTokenService } from "./api-token.service";
import { OtpService } from "./otp.service";
import { DatabaseService } from "../database/database.service";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly config: AppConfigService,
    private readonly otpService: OtpService,
    private readonly apiTokens: ApiTokenService,
    private readonly db: DatabaseService
  ) {}

  async use(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
    // Primary path: browser session cookie.
    const sessionToken = req.cookies?.[this.config.sessionCookieName];
    req.userId = sessionToken ? await this.otpService.resolveSession(sessionToken) : null;
    req.apiToken = null;

    // Secondary path: API bearer token for machine clients (e.g. the MCP server).
    // Only consulted when there is no valid browser session, so the same API
    // serves both the frontend and token-authenticated automation.
    if (!req.userId) {
      const bearer = this.extractBearerToken(req.headers?.authorization);
      if (bearer) {
        const principal = await this.apiTokens.authenticate(bearer);
        if (principal) {
          req.userId = principal.userId;
          req.apiToken = {
            tokenId: principal.tokenId,
            userId: principal.userId,
            projectId: principal.projectId,
            scopes: principal.scopes
          };
        }
      }
    }

    await this.resolveProjectSlug(req);
    next();
  }

  private async resolveProjectSlug(req: AuthenticatedRequest): Promise<void> {
    const rawUrl = String(req.url || "");
    const queryIndex = rawUrl.indexOf("?");
    const path = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
    const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
    const match = /^\/api\/projects\/([^/?]+)(\/.*)?$/.exec(path);
    if (!match) return;

    const identifier = decodeURIComponent(match[1]);
    if (identifier === "overview") return;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) return;

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

    // Rewrite before Nest guards/controllers see the request. Unknown slugs become a guaranteed
    // non-existent UUID so every project service returns a normal 404 instead of a UUID-cast 500.
    const resolved = projectId || "00000000-0000-0000-0000-000000000000";
    req.url = "/api/projects/" + resolved + (match[2] || "") + query;
  }

  private extractBearerToken(header: string | string[] | undefined): string | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match ? match[1].trim() : null;
  }
}
