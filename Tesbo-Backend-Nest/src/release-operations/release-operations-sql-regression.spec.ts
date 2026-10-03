import { readFileSync } from "fs";
import { join } from "path";

describe("Phase 7 PostgreSQL SQL regression guards", () => {
  it("types promotion status bind parameters reused inside CASE expressions", () => {
    const source = readFileSync(join(__dirname, "release-operations.service.ts"), "utf8");
    expect(source).toContain("status=$6::varchar");
    expect(source).toContain("CASE WHEN $6::varchar='approved'");
    expect(source).toContain("THEN $7::uuid ELSE NULL END");
    expect(source).not.toContain("CASE WHEN $6='approved'");
  });


  it("keeps the promotion-to-Phase-6 verification link immutable", () => {
    const migration = readFileSync(
      join(__dirname, "../../migrations/V137_post_deployment_verification.sql"),
      "utf8",
    );
    expect(migration).toContain("verification_automation_run_id is immutable");
    expect(migration).toContain("trg_release_promotions_verification_run_immutable");
    expect(migration).toContain("rollback_eligible BOOLEAN NOT NULL DEFAULT false");
  });
});
