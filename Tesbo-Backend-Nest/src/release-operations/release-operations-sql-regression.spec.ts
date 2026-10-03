import { readFileSync } from "fs";
import { join } from "path";

describe("Phase 7 PostgreSQL SQL regression guards", () => {
  it("types promotion status bind parameters reused inside CASE expressions", () => {
    const source = readFileSync(join(__dirname, "release-operations.service.ts"), "utf8");
    expect(source).toContain("status=$6::varchar");
    expect(source).toContain("CASE WHEN $6::varchar='approved'");
    expect(source).not.toContain("CASE WHEN $6='approved'");
  });
});
