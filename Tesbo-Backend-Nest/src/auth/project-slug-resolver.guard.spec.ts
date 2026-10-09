import type { ExecutionContext } from "@nestjs/common";
import { ProjectSlugResolverGuard } from "./project-slug-resolver.guard";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function context(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("ProjectSlugResolverGuard", () => {
  it("resolves a top-level project :id slug for a browser session", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: PROJECT_ID }] }),
    } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: "/api/projects/signalorbit",
      params: { id: "signalorbit" },
      userId: USER_ID,
      apiToken: null,
    };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);

    expect(req.params.id).toBe(PROJECT_ID);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("active_organization_id"),
      [USER_ID, "signalorbit"]
    );
  });

  it("resolves nested :projectId routes", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: PROJECT_ID }] }),
    } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: "/api/projects/signalorbit/qa-requirements?status=Approved",
      params: { projectId: "signalorbit" },
      userId: USER_ID,
      apiToken: null,
    };

    await guard.canActivate(context(req));

    expect(req.params.projectId).toBe(PROJECT_ID);
  });

  it("does not query or change an existing UUID project param", async () => {
    const db = { query: jest.fn() } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: `/api/projects/${PROJECT_ID}/testcases`,
      params: { projectId: PROJECT_ID },
      userId: USER_ID,
      apiToken: null,
    };

    await guard.canActivate(context(req));

    expect(req.params.projectId).toBe(PROJECT_ID);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("restricts bearer-token slug resolution to the token's own project", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: PROJECT_ID }] }),
    } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: "/api/projects/signalorbit/testcases",
      params: { projectId: "signalorbit" },
      userId: USER_ID,
      apiToken: { projectId: PROJECT_ID },
    };

    await guard.canActivate(context(req));

    expect(req.params.projectId).toBe(PROJECT_ID);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("id = $1 AND slug = $2"),
      [PROJECT_ID, "signalorbit"]
    );
  });

  it("maps an unknown slug to a guaranteed missing UUID", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: "/api/projects/not-a-project/requirements",
      params: { projectId: "not-a-project" },
      userId: USER_ID,
      apiToken: null,
    };

    await guard.canActivate(context(req));

    expect(req.params.projectId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("ignores non-project routes even if they happen to have an id param", async () => {
    const db = { query: jest.fn() } as any;
    const guard = new ProjectSlugResolverGuard(db);
    const req: any = {
      originalUrl: "/api/invitations/signalorbit",
      params: { id: "signalorbit" },
      userId: USER_ID,
    };

    await guard.canActivate(context(req));

    expect(req.params.id).toBe("signalorbit");
    expect(db.query).not.toHaveBeenCalled();
  });
});
