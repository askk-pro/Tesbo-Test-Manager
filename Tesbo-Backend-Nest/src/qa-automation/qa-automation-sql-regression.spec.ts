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
});
