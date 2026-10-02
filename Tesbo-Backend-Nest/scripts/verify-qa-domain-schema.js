const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const client = new Client({ connectionString });

async function scalar(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0];
}

async function main() {
  await client.connect();
  const projectId = randomUUID();

  try {
    const migration = await scalar(
      "select count(*)::int as count, max(version)::int as max_version from schema_migrations",
    );
    if (migration.count < 129 || migration.max_version < 129) {
      throw new Error(`Expected migration 129; got count=${migration.count}, max=${migration.max_version}`);
    }

    await client.query("BEGIN");

    await client.query(
      "insert into projects (id, key, name) values ($1, $2, $3)",
      [projectId, `CI${projectId.slice(0, 6)}`, "QA domain CI acceptance"],
    );

    await client.query(
      `insert into bugs (project_id, title, external_id)
       values ($1, 'Ticket one', 'CI-BUG-1'),
              ($1, 'Ticket two', 'CI-BUG-2')`,
      [projectId],
    );
    await client.query(
      `insert into testcases (project_id, external_id, title)
       values ($1, 'CI-TC-1', 'Test one'),
              ($1, 'CI-TC-2', 'Test two')`,
      [projectId],
    );
    await client.query(
      `insert into cycles (project_id, name)
       values ($1, 'Run one'), ($1, 'Run two')`,
      [projectId],
    );
    await client.query(
      `insert into requirements (project_id, title)
       values ($1, 'Requirement one'), ($1, 'Requirement two')`,
      [projectId],
    );

    const ids = [
      await scalar("select array_agg(human_id order by human_id) as ids from bugs where project_id=$1", [projectId]),
      await scalar("select array_agg(human_id order by human_id) as ids from testcases where project_id=$1", [projectId]),
      await scalar("select array_agg(human_id order by human_id) as ids from cycles where project_id=$1", [projectId]),
      await scalar("select array_agg(human_id order by human_id) as ids from requirements where project_id=$1", [projectId]),
    ];

    const expected = [
      ["QA-1", "QA-2"],
      ["TC-1", "TC-2"],
      ["RUN-1", "RUN-2"],
      ["REQ-1", "REQ-2"],
    ];
    ids.forEach((row, index) => {
      if (JSON.stringify(row.ids) !== JSON.stringify(expected[index])) {
        throw new Error(`Unexpected human IDs: ${JSON.stringify(ids)}`);
      }
    });

    await client.query(
      `insert into ticket_comments (project_id, ticket_id, body, source)
       select $1, id, 'CI MCP comment', 'mcp'
       from bugs where project_id=$1 and human_id='QA-1'`,
      [projectId],
    );
    await client.query(
      `insert into requirement_testcases (requirement_id, testcase_id)
       select r.id, t.id
       from requirements r
       join testcases t on t.project_id=$1 and t.human_id='TC-1'
       where r.project_id=$1 and r.human_id='REQ-1'`,
      [projectId],
    );

    const comment = await scalar(
      "select count(*)::int as count from ticket_comments where project_id=$1 and source='mcp'",
      [projectId],
    );
    const link = await scalar(
      `select count(*)::int as count
       from requirement_testcases rt
       join requirements r on r.id=rt.requirement_id
       where r.project_id=$1 and rt.deleted_at is null`,
      [projectId],
    );
    if (comment.count !== 1 || link.count !== 1) {
      throw new Error(`QA relation acceptance failed: comments=${comment.count}, links=${link.count}`);
    }

    await client.query(
      `insert into bugs (project_id, title, external_id)
       select $1, 'Generated ticket ' || g, 'CI-BUG-G' || g
       from generate_series(3,12) g`,
      [projectId],
    );
    const sequence = await scalar(
      `select count(*)::int as rows,
              count(distinct human_id)::int as unique_rows,
              min(substring(human_id from 4)::int)::int as min_no,
              max(substring(human_id from 4)::int)::int as max_no
       from bugs where project_id=$1`,
      [projectId],
    );
    if (
      sequence.rows !== 12 ||
      sequence.unique_rows !== 12 ||
      sequence.min_no !== 1 ||
      sequence.max_no !== 12
    ) {
      throw new Error(`Ticket human-ID sequence failed: ${JSON.stringify(sequence)}`);
    }

    await client.query("ROLLBACK");
    console.log("QA domain schema acceptance passed: migration 129, QA/TC/REQ/RUN IDs, comments, links, sequence.");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
