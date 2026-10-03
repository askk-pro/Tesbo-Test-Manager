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

  it("adds append-only observation evidence and an explicit observation failure state", () => {
    const migration = readFileSync(
      join(__dirname, "../../migrations/V138_observation_known_good_safe_rollback.sql"),
      "utf8",
    );
    expect(migration).toContain("'observation_failed'");
    expect(migration).toContain("CREATE TABLE release_observation_checks");
    expect(migration).toContain("release_observation_checks is append-only");
    expect(migration).toContain("rollback_recovery_status");
  });

  it("keeps Known Good human-governed and rollback recovery on the exact-SHA verification path", () => {
    const source = readFileSync(join(__dirname, "release-operations.service.ts"), "utf8");
    expect(source).toContain("Only a successfully observed release can be promoted to Known Good.");
    expect(source).toContain("A rollback recovery restores the existing Known Good and cannot redefine it.");
    expect(source).toContain("requestedGitSha: rollbackGitSha");
    expect(source).toContain("rollback_of_promotion_id");
    expect(source).toContain("return this.completeRollbackRecovery(row, run, summary)");
  });

  it("blocks stale observation and rollback from overwriting a newer current deployment", () => {
    const source = readFileSync(join(__dirname, "release-operations.service.ts"), "utf8");
    expect(source).toContain("currentDeploymentMatches");
    expect(source).toContain("This promotion is no longer the environment's current deployment.");
    expect(source).toContain("This failed release is no longer the environment's current deployment; rollback is blocked to avoid overwriting a newer release.");
    expect(source).toContain("The environment Known Good changed after this release failed; refresh before choosing a recovery action.");
  });
});
