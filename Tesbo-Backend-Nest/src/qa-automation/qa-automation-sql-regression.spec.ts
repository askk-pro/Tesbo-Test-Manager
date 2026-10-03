import { readFileSync } from "fs";
import { join } from "path";

describe("Phase 6 PostgreSQL SQL regression guards", () => {
  it("types jsonb_build_object planning counters so PostgreSQL can resolve bind parameters", () => {
    const source = readFileSync(join(__dirname, "qa-automation.service.ts"), "utf8");

    expect(source).toContain(
      "summary=jsonb_build_object('createdShards',$2::int,'skippedTargets',$3::int)"
    );
    expect(source).not.toContain(
      "summary=jsonb_build_object('createdShards',$2,'skippedTargets',$3)"
    );
  });

  it("exposes release verification context to claimed Phase-6 workers", () => {
    const source = readFileSync(join(__dirname, "qa-automation.service.ts"), "utf8");
    expect(source).toContain("verificationContext: jsonObject(triggerPayload.releaseVerification)");
    expect(source).toContain("automationContext:");
    expect(source).toContain("SELECT trigger_source,trigger_key,trigger_payload,build_id");
  });

  it("types the reused automation step-status bind parameter consistently", () => {
    const source = readFileSync(join(__dirname, "../legacy/legacy.service.ts"), "utf8");

    expect(source).toContain(
      "VALUES ($1,$2,$3,$4,$5,$6::text,$7,$8,'automation',$9,CASE WHEN $6::text='Untested' THEN NULL ELSE now() END)"
    );
  });
});
