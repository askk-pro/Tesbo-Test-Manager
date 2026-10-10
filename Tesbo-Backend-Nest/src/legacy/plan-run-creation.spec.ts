import { LegacyService } from "./legacy.service";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const PLAN = "00000000-0000-4000-8000-000000000002";
const RUN = "00000000-0000-4000-8000-000000000003";
const USER = "00000000-0000-4000-8000-000000000004";

function harness(count = 43, inserted = count, planExists = true) {
  let writes = 0;
  let committed = false;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes("SELECT id, name, target_release FROM plans")) return { rows: planExists ? [{id: PLAN, name:"Smoke", target_release:"sha"}] : [] };
    if (sql.includes("WITH RECURSIVE plan_suites")) return { rows: Array.from({length:count}, (_,i) => ({testcase_id: String(i)})) };
    if (sql.includes("INSERT INTO cycles")) { writes++; return {rows:[{id:RUN}]}; }
    if (sql.includes("INSERT INTO executions")) { writes++; return {rows:Array.from({length:inserted},(_,i)=>({id:String(i)}))}; }
    throw new Error("Unexpected SQL");
  });
  const db = { transaction: jest.fn(async (fn: (client:{query:typeof query})=>Promise<unknown>)=>{
    const result=await fn({query}); committed=true;return result;
  }) };
  const svc = Object.create(LegacyService.prototype) as LegacyService;
  Object.assign(svc,{db});
  jest.spyOn(svc as any,"requireProjectAccess").mockResolvedValue({});
  return {svc,db,query,writes:()=>writes,committed:()=>committed};
}

describe("run creation from plan",()=>{
  it("copies 43 cases and executions atomically",async()=>{
    const h=harness();
    await expect(h.svc.createCycleFromPlanForUser(USER,PROJECT,{planId:PLAN,environment:"Staging"})).resolves.toEqual({id:RUN});
    expect(h.query).toHaveBeenCalledTimes(4);
    expect(h.db.transaction).toHaveBeenCalledTimes(1);
    expect(h.committed()).toBe(true);
  });
  it("rejects an empty plan before creating a run",async()=>{
    const h=harness(0);
    await expect(h.svc.createCycleFromPlanForUser(USER,PROJECT,{planId:PLAN})).rejects.toThrow();
    expect(h.writes()).toBe(0);
  });
  it("rejects a plan not in the project",async()=>{
    const h=harness(1,1,false);
    await expect(h.svc.createCycleFromPlanForUser(USER,PROJECT,{planId:PLAN})).rejects.toThrow();
    expect(h.writes()).toBe(0);
  });
  it("rolls back on case-count mismatch",async()=>{
    const h=harness(43,42);
    await expect(h.svc.createCycleFromPlanForUser(USER,PROJECT,{planId:PLAN})).rejects.toThrow();
    expect(h.committed()).toBe(false);
  });
});
