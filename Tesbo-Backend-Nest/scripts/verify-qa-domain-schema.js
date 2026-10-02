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
    if (migration.count < 133 || migration.max_version < 133) {
      throw new Error(`Expected migration 133; got count=${migration.count}, max=${migration.max_version}`);
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

    await client.query(
      `insert into ticket_requirements (project_id, ticket_id, requirement_id)
       select $1, b.id, r.id
       from bugs b
       join requirements r on r.project_id=$1 and r.human_id='REQ-1'
       where b.project_id=$1 and b.human_id='QA-1'`,
      [projectId],
    );

    await client.query(
      `insert into attachments
         (project_id, entity_type, entity_id, file_name, content_type, file_size, storage_path, evidence_kind)
       select $1, 'bug', b.id, 'phase2.png', 'image/png', 42, 'ci/phase2.png', 'screenshot'
       from bugs b where b.project_id=$1 and b.human_id='QA-1'`,
      [projectId],
    );

    const runOne = await scalar(
      "select id from cycles where project_id=$1 and human_id='RUN-1'",
      [projectId],
    );
    const tcOne = await scalar(
      "select id from testcases where project_id=$1 and human_id='TC-1'",
      [projectId],
    );
    const qaOne = await scalar(
      "select id from bugs where project_id=$1 and human_id='QA-1'",
      [projectId],
    );

    const cycleItem = await scalar(
      `insert into cycle_items (cycle_id, testcase_id, position)
       values ($1,$2,0)
       returning id`,
      [runOne.id, tcOne.id],
    );
    const execution = await scalar(
      `insert into executions (cycle_item_id, status, reported_by)
       values ($1,'Failed','human')
       returning id`,
      [cycleItem.id],
    );
    await client.query(
      `insert into ticket_retests (project_id, ticket_id, cycle_id, decision)
       values ($1,$2,$3,'pending')`,
      [projectId, qaOne.id, runOne.id],
    );
    const stepResult = await scalar(
      `insert into execution_step_results
         (project_id, execution_id, step_number, action, expected_result, status, actual_result, reported_by)
       values ($1,$2,1,'Open login','Login opens','Failed','HTTP 500','human')
       returning id`,
      [projectId, execution.id],
    );
    await client.query(
      `insert into attachments
         (project_id, entity_type, entity_id, file_name, content_type, file_size, storage_path,
          evidence_kind, execution_step_result_id)
       values ($1,'execution',$2,'step-failure.png','image/png',84,'ci/phase3-step.png','screenshot',$3)`,
      [projectId, execution.id, stepResult.id],
    );

    await client.query(
      `insert into qa_failure_triage_snapshots
         (project_id, ticket_id, testcase_id, execution_id, failure_signature, classification,
          flake_score, evidence_snapshot, hypotheses, rerun_recommendation, input_digest)
       values ($1,$2,$3,$4,$5,'deterministic',0,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
      [
        projectId,
        qaOne.id,
        tcOne.id,
        execution.id,
        "a".repeat(64),
        JSON.stringify({ executionId: execution.id, evidenceRefs: ["EXECUTION:" + execution.id] }),
        JSON.stringify([{ hypothesis: "CI hypothesis", confidence: "low", evidenceRefs: ["EXECUTION:" + execution.id] }]),
        JSON.stringify({ shouldRerun: false, strategy: "after-change-targeted" }),
        "b".repeat(64),
      ],
    );
    await client.query(
      `insert into release_quality_gates
         (project_id, release_name, build_version, environment, readiness, blockers, warnings,
          evidence_snapshot, evidence_digest)
       values ($1,'release-ci','build-132','staging','ready_for_approval','[]'::jsonb,
               '[{"code":"FLAKY_TESTS","count":1}]'::jsonb,$2::jsonb,$3)`,
      [projectId, JSON.stringify({ releaseName: "release-ci", buildVersion: "build-132", passed: 1 }), "c".repeat(64)],
    );

    const phase5BuildOne = await scalar(
      `insert into qa_build_registry
         (project_id,repository,source_provider,git_sha,base_sha,branch_name,release_name,build_version,
          environment,config_fingerprint,deployment_timestamp,changed_files,dependency_changes,change_stats,metadata)
       values ($1,'askk-pro/qa-ci','ci',$2,$3,'main','release-ci','build-133','staging',$4,
               now() - interval '1 hour',$5::jsonb,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb)
       returning id`,
      [
        projectId,
        "1".repeat(40),
        "0".repeat(40),
        "a".repeat(64),
        JSON.stringify([{ path: "src/auth/session.ts", status: "modified", additions: 10, deletions: 2 }]),
      ],
    );
    const phase5Rule = await scalar(
      `insert into change_impact_rules
         (project_id,name,path_pattern,testcase_id,risk_weight,mandatory)
       values ($1,'CI auth impact','src/auth/**',$2,15,true)
       returning id`,
      [projectId, tcOne.id],
    );
    const phase5Plan = await scalar(
      `insert into qa_regression_plans
         (project_id,build_id,version,name,status,risk_score,risk_band,risk_factors,impact_snapshot,
          selection_summary,matrix,selected_test_count,coverage_pct)
       values ($1,$2,1,'CI smart regression','READY',45,'MEDIUM',
               '[{"code":"CHANGE_SIZE","points":5,"explanation":"CI"}]'::jsonb,
               '{"components":["Auth"]}'::jsonb,
               '{"selected":1,"impacted":1}'::jsonb,
               '[{"environment":"staging","browser":"","targetType":"manual","required":true}]'::jsonb,
               1,100)
       returning id`,
      [projectId, phase5BuildOne.id],
    );
    await client.query(
      `insert into qa_regression_plan_items
         (plan_id,testcase_id,selection_sources,reasons,risk_weight,mandatory,selected)
       values ($1,$2,'["impacted","smoke"]'::jsonb,'["CI impact rule"]'::jsonb,20,true,true)`,
      [phase5Plan.id, tcOne.id],
    );
    await client.query(
      `insert into qa_regression_plan_runs
         (plan_id,cycle_id,environment,browser,target_type,source_kind)
       values ($1,$2,'staging','','manual','initial')`,
      [phase5Plan.id, runOne.id],
    );
    const phase5Cert = await scalar(
      `insert into release_certifications
         (project_id,build_id,version,plan_id,state,validity_status,evidence_snapshot,evidence_digest,
          certificate_digest,certified_at)
       values ($1,$2,1,$3,'CERTIFIED','current',$4::jsonb,$5,$6,now())
       returning id`,
      [
        projectId,
        phase5BuildOne.id,
        phase5Plan.id,
        JSON.stringify({ buildId: phase5BuildOne.id, planId: phase5Plan.id, selected: 1 }),
        "d".repeat(64),
        "e".repeat(64),
      ],
    );
    await client.query(
      `insert into release_certification_events(certification_id,event_type,details)
       values ($1,'certified','{"source":"ci"}'::jsonb)`,
      [phase5Cert.id],
    );

    let immutableRejected = false;
    await client.query("SAVEPOINT phase5_cert_immutable");
    try {
      await client.query(
        `update release_certifications
            set evidence_snapshot='{"tampered":true}'::jsonb
          where id=$1`,
        [phase5Cert.id],
      );
    } catch (error) {
      immutableRejected = String(error && error.message || "").includes("Certified release evidence is immutable");
      await client.query("ROLLBACK TO SAVEPOINT phase5_cert_immutable");
    }
    await client.query("RELEASE SAVEPOINT phase5_cert_immutable");
    if (!immutableRejected) {
      throw new Error("Phase-5 certified evidence immutability trigger did not reject a rewrite");
    }

    const phase5BuildTwo = await scalar(
      `insert into qa_build_registry
         (project_id,repository,source_provider,git_sha,base_sha,branch_name,release_name,build_version,
          environment,config_fingerprint,deployment_timestamp,changed_files,dependency_changes,change_stats,metadata)
       values ($1,'askk-pro/qa-ci','ci',$2,$3,'main','release-ci','build-134','staging',$4,
               now(),$5::jsonb,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb)
       returning id`,
      [
        projectId,
        "2".repeat(40),
        "1".repeat(40),
        "b".repeat(64),
        JSON.stringify([{ path: "src/auth/session.ts", status: "modified", additions: 2, deletions: 1 }]),
      ],
    );

    const phase5 = await scalar(
      `select
         (select count(*)::int from qa_build_registry where project_id=$1) as builds,
         (select count(*)::int from change_impact_rules where project_id=$1 and id=$2 and mandatory=true) as impact_rules,
         (select count(*)::int from qa_regression_plans where project_id=$1 and id=$3 and selected_test_count=1) as regression_plans,
         (select count(*)::int from qa_regression_plan_items where plan_id=$3 and testcase_id=$4 and selected=true) as plan_items,
         (select count(*)::int from qa_regression_plan_runs where plan_id=$3 and cycle_id=$5 and target_type='manual') as plan_runs,
         (select count(*)::int from release_certifications where id=$6 and state='CERTIFIED' and validity_status='superseded') as superseded_certifications,
         (select count(*)::int from release_certification_events where certification_id=$6 and event_type='superseded'
           and details->>'supersedingBuildId'=$7::text) as supersession_events`,
      [projectId, phase5Rule.id, phase5Plan.id, tcOne.id, runOne.id, phase5Cert.id, phase5BuildTwo.id],
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
    const ticketRequirement = await scalar(
      `select count(*)::int as count
       from ticket_requirements tr
       join bugs b on b.id=tr.ticket_id
       where tr.project_id=$1 and b.human_id='QA-1' and tr.deleted_at is null`,
      [projectId],
    );
    const ticketEvidence = await scalar(
      `select count(*)::int as count
       from attachments a
       join bugs b on b.id=a.entity_id
       where a.project_id=$1 and a.entity_type='bug' and b.human_id='QA-1'
         and a.evidence_kind='screenshot' and a.deleted_at is null`,
      [projectId],
    );
    const phase4 = await scalar(
      `select
         (select count(*)::int
            from qa_failure_triage_snapshots
           where project_id=$1 and ticket_id=$2 and testcase_id=$3 and execution_id=$4
             and classification='deterministic' and failure_signature=$5 and input_digest=$6) as triage_snapshots,
         (select count(*)::int
            from release_quality_gates
           where project_id=$1 and release_name='release-ci' and build_version='build-132'
             and environment='staging' and readiness='ready_for_approval'
             and decision is null and evidence_digest=$7) as release_gates`,
      [projectId, qaOne.id, tcOne.id, execution.id, "a".repeat(64), "b".repeat(64), "c".repeat(64)],
    );
    const phase3 = await scalar(
      `select
         (select count(*)::int from ticket_retests where project_id=$1) as retests,
         (select count(*)::int from execution_step_results where project_id=$1 and status='Failed') as step_results,
         (select count(*)::int
            from attachments a
            join execution_step_results es on es.id=a.execution_step_result_id
           where a.project_id=$1 and a.entity_type='execution' and es.step_number=1 and a.deleted_at is null) as step_evidence`,
      [projectId],
    );
    if (
      comment.count !== 1 ||
      link.count !== 1 ||
      ticketRequirement.count !== 1 ||
      ticketEvidence.count !== 1 ||
      phase3.retests !== 1 ||
      phase3.step_results !== 1 ||
      phase3.step_evidence !== 1 ||
      phase4.triage_snapshots !== 1 ||
      phase4.release_gates !== 1 ||
      phase5.builds !== 2 ||
      phase5.impact_rules !== 1 ||
      phase5.regression_plans !== 1 ||
      phase5.plan_items !== 1 ||
      phase5.plan_runs !== 1 ||
      phase5.superseded_certifications !== 1 ||
      phase5.supersession_events !== 1
    ) {
      throw new Error(
        `QA relation acceptance failed: comments=${comment.count}, requirement_testcases=${link.count}, ticket_requirements=${ticketRequirement.count}, ticket_evidence=${ticketEvidence.count}, retests=${phase3.retests}, step_results=${phase3.step_results}, step_evidence=${phase3.step_evidence}, triage_snapshots=${phase4.triage_snapshots}, release_gates=${phase4.release_gates}, phase5=${JSON.stringify(phase5)}`,
      );
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
    console.log("QA domain schema acceptance passed: migration 133, QA/TC/REQ/RUN IDs, retest lineage, step evidence, failure triage, release QA gates, change-aware regression plans, immutable certifications, deployment supersession, traceability links and sequence.");
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
