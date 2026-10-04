import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";

import { decryptSecret, encryptSecret } from "../common/crypto.util";
import { DatabaseService } from "../database/database.service";
import { LegacyService } from "../legacy/legacy.service";

type Body = Record<string, any>;
export type EngineeringProvider = "azure-devops" | "github";

function providerFrom(value: string): EngineeringProvider {
  if (value !== "azure-devops" && value !== "github") {
    throw new BadRequestException({ error: "Unsupported engineering integration provider." });
  }
  return value;
}

function providerLabel(provider: EngineeringProvider): string {
  return provider === "azure-devops" ? "Microsoft Azure DevOps" : "GitHub";
}

function settingsKey(provider: EngineeringProvider): "azureDevOps" | "github" {
  return provider === "azure-devops" ? "azureDevOps" : "github";
}

function parseSettings(raw: unknown): Body {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Body;
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function normalizeProjectRole(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[- ]/g, "_");
}

function htmlToText(value: unknown): string {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeAzureOrganization(value: unknown): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const match = /^https?:\/\/dev\.azure\.com\/([^/?#]+)/i.exec(raw);
  const organization = match ? match[1] : raw.replace(/^\/+|\/+$/g, "").split("/")[0];
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(organization) ? organization : "";
}

function normalizeGithubOrganization(value: unknown): string {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const match = /^https?:\/\/github\.com\/([^/?#]+)/i.exec(raw);
  const organization = match ? match[1] : raw.replace(/^\/+|\/+$/g, "").split("/")[0];
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(organization) ? organization : "";
}

@Injectable()
export class EngineeringIntegrationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly legacy: LegacyService,
  ) {}

  private async connection(organizationId: string, provider: EngineeringProvider): Promise<Body | null> {
    const result = await this.db.query(
      "SELECT * FROM integration_connections WHERE organization_id = $1 AND provider = $2 AND disconnected_at IS NULL LIMIT 1",
      [organizationId, provider],
    );
    return result.rows[0] || null;
  }

  private token(connection: Body): string {
    const raw = decryptSecret(String(connection.access_token || ""));
    if (!raw) {
      throw new BadRequestException({ error: providerLabel(connection.provider as EngineeringProvider) + " is not connected." });
    }
    return raw;
  }

  private async remoteFetch<T>(
    provider: EngineeringProvider,
    connection: Body,
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...((init.headers as Record<string, string>) || {}),
    };
    const token = this.token(connection);
    if (provider === "azure-devops") {
      headers.Authorization = "Basic " + Buffer.from(":" + token).toString("base64");
    } else {
      headers.Authorization = "Bearer " + token;
      headers["X-GitHub-Api-Version"] = "2026-03-10";
      headers.Accept = "application/vnd.github+json";
    }

    const response = await fetch(url, { ...init, headers });
    const text = await response.text().catch(() => "");
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException({
          error: providerLabel(provider) + " access was refused. Check the connected token and its permissions.",
        });
      }
      throw new BadRequestException({
        error: providerLabel(provider) + " request failed (" + response.status + ").",
        detail: String(payload?.message || payload?.error || text).slice(0, 500),
      });
    }
    return payload as T;
  }

  private async requireProject(
    userId: string | null | undefined,
    projectId: string,
    manage = false,
  ): Promise<{ access: Body; project: Body; organizationId: string }> {
    const access = await this.legacy.requireProjectAccess(userId, projectId);
    if (manage) {
      const role = normalizeProjectRole(access.caller_role);
      if (!["owner", "manager", "admin", "test_manager"].includes(role)) {
        throw new ForbiddenException({ error: "QA Engineers cannot change project integrations." });
      }
    }
    const project = await this.legacy.getProject(projectId);
    return {
      access,
      project,
      organizationId: String(access.organization_id || project.organizationId || ""),
    };
  }

  async workspaceStatus(userId: string | null | undefined, providerValue: string) {
    const provider = providerFrom(providerValue);
    const workspace = await this.legacy.workspace(userId);
    const connection = await this.connection(String(workspace.id), provider);
    if (!connection) {
      return { connected: false, externalId: null, siteUrl: null, connectedProjects: [] };
    }

    const key = settingsKey(provider);
    const projects = await this.db.query(
      "SELECT id AS project_id, name AS project_name, key AS project_key " +
      "FROM projects WHERE organization_id = $1 AND archived_at IS NULL " +
      "AND COALESCE(settings->$2->>'remoteId', '') <> '' ORDER BY name",
      [workspace.id, key],
    );

    return {
      connected: true,
      provider,
      externalId: connection.external_id,
      siteUrl: connection.site_url,
      authMethod: connection.auth_method,
      createdAt: connection.created_at,
      connectedProjects: projects.rows.map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        projectKey: row.project_key,
      })),
    };
  }

  async connectWorkspace(userId: string | null | undefined, providerValue: string, body: Body) {
    const provider = providerFrom(providerValue);
    const workspace = await this.legacy.workspace(userId);
    if (normalizeProjectRole(workspace.role) !== "owner") {
      throw new ForbiddenException({ error: "Only the workspace owner can manage integrations" });
    }

    const token = String(body.token || body.personalAccessToken || "").trim();
    if (!token) throw new BadRequestException({ error: "Access token is required." });

    let externalId = "";
    let siteUrl = "";

    if (provider === "azure-devops") {
      externalId = normalizeAzureOrganization(body.organization || body.externalId);
      if (!externalId) {
        throw new BadRequestException({
          error: "Enter a valid Azure DevOps organization name or https://dev.azure.com/<organization> URL.",
        });
      }
      siteUrl = "https://dev.azure.com/" + externalId;
      const response = await fetch(siteUrl + "/_apis/projects?$top=1&api-version=7.1", {
        headers: {
          Accept: "application/json",
          Authorization: "Basic " + Buffer.from(":" + token).toString("base64"),
        },
      });
      if (!response.ok) {
        throw new BadRequestException({
          error: "Microsoft Azure DevOps connection failed (" + response.status + "). Check the organization and PAT permissions.",
        });
      }
    } else {
      externalId = normalizeGithubOrganization(body.organization || body.externalId);
      if (!externalId) {
        throw new BadRequestException({ error: "Enter a valid GitHub organization name or URL." });
      }
      siteUrl = "https://github.com/" + externalId;
      const response = await fetch("https://api.github.com/orgs/" + encodeURIComponent(externalId), {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });
      if (!response.ok) {
        throw new BadRequestException({
          error: "GitHub organization connection failed (" + response.status + "). Check the organization and token permissions.",
        });
      }
    }

    const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 16);
    const expiresAt = "2999-12-31T23:59:59.000Z";
    const result = await this.db.query(
      "INSERT INTO integration_connections " +
      "(organization_id, provider, external_id, site_url, access_token, refresh_token, token_expires_at, connected_by, auth_method, personal_token_identifier) " +
      "VALUES ($1,$2,$3,$4,$5,'',$6,$7,'personal_token',$8) " +
      "ON CONFLICT (organization_id, provider) DO UPDATE SET " +
      "external_id=EXCLUDED.external_id, site_url=EXCLUDED.site_url, access_token=EXCLUDED.access_token, refresh_token='', " +
      "token_expires_at=EXCLUDED.token_expires_at, connected_by=EXCLUDED.connected_by, auth_method='personal_token', " +
      "personal_token_identifier=EXCLUDED.personal_token_identifier, disconnected_at=NULL, auth_error=NULL, auth_error_at=NULL, " +
      "auth_error_refresh_fingerprint=NULL, updated_at=now() RETURNING id, external_id, site_url",
      [workspace.id, provider, externalId, siteUrl, encryptSecret(token), expiresAt, userId || null, fingerprint],
    );

    return {
      connected: true,
      connectionId: result.rows[0].id,
      externalId: result.rows[0].external_id,
      siteUrl: result.rows[0].site_url,
    };
  }

  async disconnectWorkspace(userId: string | null | undefined, providerValue: string) {
    const provider = providerFrom(providerValue);
    const workspace = await this.legacy.workspace(userId);
    if (normalizeProjectRole(workspace.role) !== "owner") {
      throw new ForbiddenException({ error: "Only the workspace owner can manage integrations" });
    }

    await this.db.query(
      "UPDATE integration_connections SET disconnected_at=now(), access_token='', refresh_token='', updated_at=now() " +
      "WHERE organization_id=$1 AND provider=$2 AND disconnected_at IS NULL",
      [workspace.id, provider],
    );
    return { disconnected: true };
  }

  async projectStatus(userId: string | null | undefined, projectId: string, providerValue: string) {
    const provider = providerFrom(providerValue);
    const { project, organizationId } = await this.requireProject(userId, projectId);
    const connection = await this.connection(organizationId, provider);
    const settings = parseSettings(project.settings);
    const mapping = settings[settingsKey(provider)] as Body | undefined;

    return {
      connected: Boolean(connection),
      siteUrl: connection?.site_url || null,
      externalId: connection?.external_id || null,
      mappedItem: mapping?.remoteId
        ? {
            id: String(mapping.remoteId),
            key: String(mapping.remoteKey || ""),
            name: String(mapping.remoteName || mapping.remoteKey || mapping.remoteId),
            context: String(mapping.context || ""),
          }
        : null,
      lastSyncedAt: mapping?.lastSyncedAt || null,
      lastSyncedCount: Number(mapping?.lastSyncedCount || 0),
      lastTotalCount: Number(mapping?.lastTotalCount || 0),
    };
  }

  async azureProjects(userId: string | null | undefined, projectId: string) {
    const { project, organizationId } = await this.requireProject(userId, projectId);
    const connection = await this.connection(organizationId, "azure-devops");
    if (!connection) {
      throw new NotFoundException({ error: "Microsoft Azure DevOps is not connected for this workspace." });
    }
    const settings = parseSettings(project.settings);
    const current = (settings.azureDevOps || {}) as Body;
    const data = await this.remoteFetch<Body>(
      "azure-devops",
      connection,
      String(connection.site_url).replace(/\/+$/, "") + "/_apis/projects?$top=1000&api-version=7.1",
    );

    return (Array.isArray(data.value) ? data.value : [])
      .map((item: Body) => ({
        id: String(item.id || ""),
        key: String(item.name || item.id || ""),
        name: String(item.name || item.id || "Azure DevOps project"),
        context: String(connection.external_id || ""),
        connected: String(current.remoteId || "") === String(item.id || ""),
      }))
      .filter((item: Body) => item.id);
  }

  async githubRepositories(userId: string | null | undefined, projectId: string) {
    const { project, organizationId } = await this.requireProject(userId, projectId);
    const connection = await this.connection(organizationId, "github");
    if (!connection) throw new NotFoundException({ error: "GitHub is not connected for this workspace." });

    const settings = parseSettings(project.settings);
    const current = (settings.github || {}) as Body;
    const organization = String(connection.external_id || "");
    const repositories: Body[] = [];

    for (let page = 1; page <= 10; page += 1) {
      const rows = await this.remoteFetch<Body[]>(
        "github",
        connection,
        "https://api.github.com/orgs/" + encodeURIComponent(organization) +
          "/repos?type=all&sort=full_name&per_page=100&page=" + page,
      );
      repositories.push(...(Array.isArray(rows) ? rows : []));
      if (!Array.isArray(rows) || rows.length < 100) break;
    }

    return repositories
      .map((item) => ({
        id: String(item.id || ""),
        key: String(item.full_name || item.name || item.id || ""),
        name: String(item.name || item.full_name || item.id || "GitHub repository"),
        context: String(item.full_name || ""),
        connected: String(current.remoteId || "") === String(item.id || ""),
        private: Boolean(item.private),
        archived: Boolean(item.archived),
      }))
      .filter((item) => item.id);
  }

  private async saveMapping(
    userId: string | null | undefined,
    projectId: string,
    provider: EngineeringProvider,
    remote: { id: string; key: string; name: string; context?: string } | null,
  ) {
    const { project } = await this.requireProject(userId, projectId, true);
    const settings = parseSettings(project.settings);
    const key = settingsKey(provider);

    if (!remote) {
      delete settings[key];
    } else {
      const previous = (settings[key] || {}) as Body;
      settings[key] = {
        remoteId: remote.id,
        remoteKey: remote.key,
        remoteName: remote.name,
        context: remote.context || "",
        linkedAt:
          previous.remoteId === remote.id
            ? previous.linkedAt || new Date().toISOString()
            : new Date().toISOString(),
        lastSyncedAt: previous.remoteId === remote.id ? previous.lastSyncedAt || null : null,
        lastSyncedCount: previous.remoteId === remote.id ? Number(previous.lastSyncedCount || 0) : 0,
        lastTotalCount: previous.remoteId === remote.id ? Number(previous.lastTotalCount || 0) : 0,
      };
    }

    await this.db.query(
      "UPDATE projects SET settings=$2::jsonb, updated_at=now() WHERE id=$1",
      [projectId, JSON.stringify(settings)],
    );
    return { linked: remote ? 1 : 0 };
  }

  async mapAzureProject(userId: string | null | undefined, projectId: string, body: Body) {
    const remoteId = String(body.remoteId || body.projectId || "").trim();
    if (!remoteId) return this.saveMapping(userId, projectId, "azure-devops", null);
    const projects = await this.azureProjects(userId, projectId);
    const remote = projects.find((item: Body) => String(item.id) === remoteId);
    if (!remote) throw new NotFoundException({ error: "Azure DevOps project not found." });

    return this.saveMapping(userId, projectId, "azure-devops", {
      id: String(remote.id),
      key: String(remote.key),
      name: String(remote.name),
      context: String(remote.context || ""),
    });
  }

  async mapGithubRepository(userId: string | null | undefined, projectId: string, body: Body) {
    const remoteId = String(body.remoteId || body.repositoryId || "").trim();
    if (!remoteId) return this.saveMapping(userId, projectId, "github", null);
    const repositories = await this.githubRepositories(userId, projectId);
    const remote = repositories.find((item: Body) => String(item.id) === remoteId);
    if (!remote) throw new NotFoundException({ error: "GitHub repository not found." });

    return this.saveMapping(userId, projectId, "github", {
      id: String(remote.id),
      key: String(remote.key),
      name: String(remote.name),
      context: String(remote.context || remote.key || ""),
    });
  }

  private async upsertRequirement(
    projectId: string,
    userId: string,
    sourceKey: string,
    input: {
      title: string;
      description: string;
      status: string;
      priority: string | null;
      sourceUrl: string;
    },
  ): Promise<"created" | "updated"> {
    const existing = await this.db.query(
      "SELECT id FROM requirements WHERE project_id=$1 AND source_provider='other' AND source_key=$2 AND deleted_at IS NULL LIMIT 1",
      [projectId, sourceKey],
    );

    if (existing.rows[0]) {
      await this.db.query(
        "UPDATE requirements SET title=$3, description=$4, status=$5, priority=$6, source_url=$7, updated_by=$8, updated_at=now() " +
          "WHERE id=$1 AND project_id=$2",
        [
          existing.rows[0].id,
          projectId,
          input.title,
          input.description,
          input.status,
          input.priority,
          input.sourceUrl,
          userId,
        ],
      );
      return "updated";
    }

    await this.db.query(
      "INSERT INTO requirements " +
        "(project_id,title,description,status,priority,source_provider,source_key,source_url,created_by,updated_by) " +
        "VALUES ($1,$2,$3,$4,$5,'other',$6,$7,$8,$8)",
      [
        projectId,
        input.title,
        input.description,
        input.status,
        input.priority,
        sourceKey,
        input.sourceUrl,
        userId,
      ],
    );
    return "created";
  }

  private async finishSync(
    projectId: string,
    provider: EngineeringProvider,
    total: number,
    synced: number,
    created: number,
    updated: number,
  ) {
    const project = await this.legacy.getProject(projectId);
    const settings = parseSettings(project.settings);
    const key = settingsKey(provider);
    const mapping = (settings[key] || {}) as Body;
    settings[key] = {
      ...mapping,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedCount: synced,
      lastTotalCount: total,
    };

    await this.db.query(
      "UPDATE projects SET settings=$2::jsonb, updated_at=now() WHERE id=$1",
      [projectId, JSON.stringify(settings)],
    );

    return {
      ok: true,
      total,
      synced,
      created,
      updated,
      syncedAt: settings[key].lastSyncedAt,
    };
  }

  async syncAzure(userId: string | null | undefined, projectId: string) {
    const { project, organizationId } = await this.requireProject(userId, projectId);
    const connection = await this.connection(organizationId, "azure-devops");
    if (!connection) {
      throw new NotFoundException({ error: "Microsoft Azure DevOps is not connected for this workspace." });
    }

    const settings = parseSettings(project.settings);
    const mapping = settings.azureDevOps as Body | undefined;
    const remoteId = String(mapping?.remoteId || "");
    if (!remoteId) throw new BadRequestException({ error: "Link an Azure DevOps project before syncing." });

    const base = String(connection.site_url).replace(/\/+$/, "");
    const wiql = await this.remoteFetch<Body>(
      "azure-devops",
      connection,
      base + "/" + encodeURIComponent(remoteId) + "/_apis/wit/wiql?api-version=7.1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN " +
            "('User Story','Product Backlog Item','Requirement','Feature','Epic','Bug','Issue') " +
            "ORDER BY [System.ChangedDate] DESC",
        }),
      },
    );

    const ids = (Array.isArray(wiql.workItems) ? wiql.workItems : [])
      .map((row: Body) => Number(row.id))
      .filter((id: number) => Number.isInteger(id) && id > 0);

    const fields = [
      "System.Id",
      "System.Title",
      "System.Description",
      "System.State",
      "System.WorkItemType",
      "Microsoft.VSTS.Common.Priority",
      "System.AssignedTo",
      "System.CreatedBy",
      "System.CreatedDate",
      "System.ChangedDate",
      "System.Tags",
    ].join(",");

    const workItems: Body[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const data = await this.remoteFetch<Body>(
        "azure-devops",
        connection,
        base +
          "/" +
          encodeURIComponent(remoteId) +
          "/_apis/wit/workitems?ids=" +
          batch.join(",") +
          "&fields=" +
          encodeURIComponent(fields) +
          "&api-version=7.1",
      );
      workItems.push(...(Array.isArray(data.value) ? data.value : []));
    }

    const uid = String(userId || "");
    let created = 0;
    let updated = 0;

    for (const item of workItems) {
      const itemFields = (item.fields || {}) as Body;
      const id = String(item.id || itemFields["System.Id"] || "").trim();
      if (!id) continue;

      const priorityNumber = Number(itemFields["Microsoft.VSTS.Common.Priority"] || 0);
      const priority =
        priorityNumber >= 1 && priorityNumber <= 4
          ? ["P0", "P1", "P2", "P3"][priorityNumber - 1]
          : null;

      const assigned = itemFields["System.AssignedTo"];
      const assignedName =
        assigned && typeof assigned === "object"
          ? String(assigned.displayName || assigned.uniqueName || "")
          : String(assigned || "");

      const type = String(itemFields["System.WorkItemType"] || "");
      const tags = String(itemFields["System.Tags"] || "");
      const description = [
        htmlToText(itemFields["System.Description"]),
        "Azure DevOps work item #" + id,
        type ? "Type: " + type : "",
        assignedName ? "Assigned to: " + assignedName : "",
        tags ? "Tags: " + tags : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const sourceUrl =
        base +
        "/" +
        encodeURIComponent(String(mapping?.remoteName || mapping?.remoteKey || remoteId)) +
        "/_workitems/edit/" +
        encodeURIComponent(id);

      const outcome = await this.upsertRequirement(
        projectId,
        uid,
        "azure-devops:" + String(connection.external_id) + ":" + remoteId + ":" + id,
        {
          title: String(itemFields["System.Title"] || "Azure DevOps work item #" + id).slice(0, 512),
          description,
          status: String(itemFields["System.State"] || "Draft"),
          priority,
          sourceUrl,
        },
      );

      if (outcome === "created") created += 1;
      else updated += 1;
    }

    return this.finishSync(projectId, "azure-devops", ids.length, workItems.length, created, updated);
  }

  private githubPriority(issue: Body): string | null {
    const labels = (Array.isArray(issue.labels) ? issue.labels : [])
      .map((label: any) => String(typeof label === "string" ? label : label?.name || "").toLowerCase());
    const compact = labels.map((label: string) => label.replace(/[^a-z0-9]/g, ""));
    if (compact.some((label) => ["p0", "priorityp0", "critical", "prioritycritical", "urgent", "priorityurgent"].includes(label))) return "P0";
    if (compact.some((label) => ["p1", "priorityp1", "high", "priorityhigh"].includes(label))) return "P1";
    if (compact.some((label) => ["p2", "priorityp2", "medium", "prioritymedium"].includes(label))) return "P2";
    if (compact.some((label) => ["p3", "priorityp3", "low", "prioritylow"].includes(label))) return "P3";
    return null;
  }

  async syncGithub(userId: string | null | undefined, projectId: string) {
    const { project, organizationId } = await this.requireProject(userId, projectId);
    const connection = await this.connection(organizationId, "github");
    if (!connection) throw new NotFoundException({ error: "GitHub is not connected for this workspace." });

    const settings = parseSettings(project.settings);
    const mapping = settings.github as Body | undefined;
    const fullName = String(mapping?.context || mapping?.remoteKey || "");
    if (!mapping?.remoteId || !fullName.includes("/")) {
      throw new BadRequestException({ error: "Link a GitHub repository before syncing." });
    }

    const parts = fullName.split("/", 2);
    const owner = parts[0];
    const repo = parts[1];
    const issues: Body[] = [];

    for (let page = 1; page <= 10; page += 1) {
      const rows = await this.remoteFetch<Body[]>(
        "github",
        connection,
        "https://api.github.com/repos/" +
          encodeURIComponent(owner) +
          "/" +
          encodeURIComponent(repo) +
          "/issues?state=all&sort=updated&direction=desc&per_page=100&page=" +
          page,
      );
      issues.push(...(Array.isArray(rows) ? rows : []));
      if (!Array.isArray(rows) || rows.length < 100) break;
    }

    const ticketIssues = issues.filter((issue) => !issue.pull_request);
    const uid = String(userId || "");
    let created = 0;
    let updated = 0;

    for (const issue of ticketIssues) {
      const number = String(issue.number || "").trim();
      if (!number) continue;

      const labels = (Array.isArray(issue.labels) ? issue.labels : [])
        .map((label: any) => String(typeof label === "string" ? label : label?.name || ""))
        .filter(Boolean);

      const assignees = (Array.isArray(issue.assignees) ? issue.assignees : [])
        .map((user: Body) => String(user?.login || ""))
        .filter(Boolean);

      const description = [
        String(issue.body || "").trim(),
        "GitHub issue #" + number,
        labels.length ? "Labels: " + labels.join(", ") : "",
        assignees.length ? "Assignees: " + assignees.join(", ") : "",
        issue.milestone?.title ? "Milestone: " + issue.milestone.title : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const outcome = await this.upsertRequirement(
        projectId,
        uid,
        "github:" + String(mapping.remoteId) + ":" + number,
        {
          title: String(issue.title || "GitHub issue #" + number).slice(0, 512),
          description,
          status: String(issue.state || "open"),
          priority: this.githubPriority(issue),
          sourceUrl: String(issue.html_url || "https://github.com/" + owner + "/" + repo + "/issues/" + number),
        },
      );

      if (outcome === "created") created += 1;
      else updated += 1;
    }

    return this.finishSync(projectId, "github", issues.length, ticketIssues.length, created, updated);
  }
}
