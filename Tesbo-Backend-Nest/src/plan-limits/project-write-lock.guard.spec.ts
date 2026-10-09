import type { ExecutionContext } from "@nestjs/common";
import { ProjectWriteLockGuard } from "./project-write-lock.guard";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

function context(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("ProjectWriteLockGuard friendly project routes", () => {
  it("enforces write limits on a slug URL after the resolver canonicalizes the route param", async () => {
    const projectLookup = {
      getProjectBasics: jest.fn().mockResolvedValue({ organizationId: ORG_ID, archivedAt: null }),
    } as any;
    const planLimits = { assertProjectWritable: jest.fn().mockResolvedValue(undefined) } as any;
    const guard = new ProjectWriteLockGuard(projectLookup, planLimits);

    const req = {
      method: "POST",
      originalUrl: "/api/projects/signalorbit/testcases",
      params: { projectId: PROJECT_ID },
    };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(projectLookup.getProjectBasics).toHaveBeenCalledWith(PROJECT_ID);
    expect(planLimits.assertProjectWritable).toHaveBeenCalledWith(ORG_ID, PROJECT_ID);
  });

  it("still exempts archiving the project itself when the browser URL uses a slug", async () => {
    const projectLookup = { getProjectBasics: jest.fn() } as any;
    const planLimits = { assertProjectWritable: jest.fn() } as any;
    const guard = new ProjectWriteLockGuard(projectLookup, planLimits);

    const req = {
      method: "DELETE",
      originalUrl: "/api/projects/signalorbit",
      params: { id: PROJECT_ID },
    };

    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(projectLookup.getProjectBasics).not.toHaveBeenCalled();
    expect(planLimits.assertProjectWritable).not.toHaveBeenCalled();
  });
});
