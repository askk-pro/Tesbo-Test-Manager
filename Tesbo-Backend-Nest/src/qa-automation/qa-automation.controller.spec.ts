import { QaAutomationController } from "./qa-automation.controller";

describe("QaAutomationController machine-client identity", () => {
  function makeController() {
    const service = {
      claimShard: jest.fn().mockResolvedValue({ shard: null }),
      heartbeatShard: jest.fn().mockResolvedValue({ ok: true }),
      completeShard: jest.fn().mockResolvedValue({ ok: true }),
      triggerManual: jest.fn().mockResolvedValue({ id: "run-1" }),
      listRuns: jest.fn().mockResolvedValue([]),
      getRun: jest.fn().mockResolvedValue({}),
      listSchedules: jest.fn().mockResolvedValue([]),
      createSchedule: jest.fn().mockResolvedValue({}),
      listAlerts: jest.fn().mockResolvedValue([]),
      acknowledgeAlert: jest.fn().mockResolvedValue({}),
      dashboard: jest.fn().mockResolvedValue({}),
    } as any;
    return { controller: new QaAutomationController(service), service };
  }

  const tokenRequest = {
    userId: null,
    apiToken: {
      tokenId: "token-1",
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      scopes: ["read", "write"],
    },
  } as any;

  it("passes the API token issuer identity to worker claim service calls", async () => {
    const { controller, service } = makeController();
    await controller.claim(
      tokenRequest,
      tokenRequest.apiToken.projectId,
      { workerId: "playwright-1", browsers: ["chrome"] },
    );
    expect(service.claimShard).toHaveBeenCalledWith(
      tokenRequest.apiToken.userId,
      tokenRequest.apiToken.projectId,
      expect.objectContaining({ workerId: "playwright-1" }),
    );
  });

  it("passes the token issuer identity to event/manual trigger calls", async () => {
    const { controller, service } = makeController();
    await controller.trigger(
      tokenRequest,
      tokenRequest.apiToken.projectId,
      { buildId: "00000000-0000-4000-8000-000000000003" },
    );
    expect(service.triggerManual).toHaveBeenCalledWith(
      tokenRequest.apiToken.userId,
      tokenRequest.apiToken.projectId,
      expect.any(Object),
    );
  });

  it("rejects a token scoped to another project before reaching the service", async () => {
    const { controller, service } = makeController();
    expect(() =>
      controller.claim(
        tokenRequest,
        "00000000-0000-4000-8000-000000000099",
        { workerId: "playwright-1" },
      ),
    ).toThrow();
    expect(service.claimShard).not.toHaveBeenCalled();
  });

  it("requires write scope for worker claims", async () => {
    const { controller, service } = makeController();
    const readOnly = {
      ...tokenRequest,
      apiToken: { ...tokenRequest.apiToken, scopes: ["read"] },
    };
    expect(() =>
      controller.claim(readOnly as any, tokenRequest.apiToken.projectId, { workerId: "playwright-1" }),
    ).toThrow();
    expect(service.claimShard).not.toHaveBeenCalled();
  });
});
