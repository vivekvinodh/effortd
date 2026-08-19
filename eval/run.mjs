#!/usr/bin/env node
/**
 * E7 eval harness: cost-vs-success across effort levels, executed by real
 * Claude Code (`claude -p`) through effortd, with effortd's own telemetry as
 * the cost meter (dogfooding E4).
 *
 * HONESTY CONTRACT (plan §10): the v1 task set is TOY-CLASS (deterministic,
 * self-checkable, single-answer). RECEIPTS.md must state this; these curves
 * bound simple-task behavior only and say nothing about long-horizon work.
 *
 * Plan rule 10: a live run spends real usage and REQUIRES founder approval —
 * enforced mechanically: refuses to run without --approved. Use --dry-run to
 * see the matrix and projected budget.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TASKS = [
  {
    id: "fib10",
    prompt:
      "What is the 10th Fibonacci number (F1=1, F2=1)? Reply with just the number.",
    check: (answer) => answer.trim() === "55",
  },
  {
    id: "primes100",
    prompt:
      "How many prime numbers are strictly below 100? Reply with just the number.",
    check: (answer) => answer.trim() === "25",
  },
  {
    id: "reverse-fn",
    prompt:
      "Reply with ONLY a single-line JavaScript arrow function expression that reverses a string. No prose, no backticks.",
    check: (answer) => {
      try {
        const fn = (0, eval)(answer.trim());
        return typeof fn === "function" && fn("abcd") === "dcba";
      } catch {
        return false;
      }
    },
  },
];

const EFFORTS = ["low", "medium", "high", "xhigh"];
const TRIALS = Number(process.env.EVAL_TRIALS ?? 3);
const GATEWAY = process.env.EVAL_GATEWAY ?? "http://127.0.0.1:4141/anthropic";
const TELEMETRY = join(homedir(), ".effortd", "requests.jsonl");
const RESULTS_DIR = join(process.cwd(), "eval");
const RESULTS = join(RESULTS_DIR, "results.jsonl");

// Baseline from live E6.1 observations: one trivial `claude -p` call carried
// ~$0.27–$1.11 estimated (cache-write dominated). Midpoint used for projection.
const EST_COST_PER_CALL_USD = [0.27, 1.11];

const totalCalls = TASKS.length * EFFORTS.length * TRIALS;
const projection = {
  tasks: TASKS.map((t) => t.id),
  efforts: EFFORTS,
  trials: TRIALS,
  totalCalls,
  projectedUsdRange: [
    +(totalCalls * EST_COST_PER_CALL_USD[0]).toFixed(2),
    +(totalCalls * EST_COST_PER_CALL_USD[1]).toFixed(2),
  ],
  note: "subscription-equivalent estimate; billed as claude.ai usage-limit burn, not dollars, when run on a subscription login",
};

if (process.argv.includes("--dry-run")) {
  console.log("effortd eval — DRY RUN (no calls made)");
  console.log(JSON.stringify(projection, null, 2));
  console.log(
    `\nBudget math: ${TASKS.length} tasks × ${EFFORTS.length} efforts × ${TRIALS} trials = ${totalCalls} calls`,
  );
  console.log(
    `Projected: $${projection.projectedUsdRange[0]}–$${projection.projectedUsdRange[1]} equivalent (baseline: live E6.1 per-call observations)`,
  );
  console.log("\nLive run requires BOTH: effortd running, and --approved (plan rule 10).");
  process.exit(0);
}

if (!process.argv.includes("--approved")) {
  console.error(
    "effortd eval: refusing to spend without --approved (founder approval, plan rule 10). Use --dry-run to preview.",
  );
  process.exit(1);
}

function telemetryLineCount() {
  try {
    return readFileSync(TELEMETRY, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function newTelemetryCost(sinceLine) {
  try {
    const lines = readFileSync(TELEMETRY, "utf8").split("\n").filter(Boolean);
    let cost = 0;
    let output = 0;
    for (const line of lines.slice(sinceLine)) {
      const record = JSON.parse(line);
      cost += record.costUsd ?? 0;
      output += record.usage?.outputTokens ?? 0;
    }
    return { cost: +cost.toFixed(6), outputTokens: output, requests: lines.length - sinceLine };
  } catch {
    return { cost: null, outputTokens: null, requests: 0 };
  }
}

mkdirSync(RESULTS_DIR, { recursive: true });
const summary = new Map(); // effort -> {pass, total, cost}

for (const effort of EFFORTS) {
  for (const task of TASKS) {
    for (let trial = 1; trial <= TRIALS; trial += 1) {
      const before = telemetryLineCount();
      const run = spawnSync("claude", ["-p", task.prompt], {
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: GATEWAY,
          CLAUDE_CODE_EFFORT_LEVEL: effort,
        },
        encoding: "utf8",
        timeout: 300_000,
      });
      const answer = (run.stdout ?? "").trim();
      const pass = run.status === 0 && task.check(answer);
      const meter = newTelemetryCost(before);
      const row = {
        ts: new Date().toISOString(),
        task: task.id,
        effort,
        trial,
        pass,
        answerChars: answer.length,
        meter,
      };
      appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);
      const agg = summary.get(effort) ?? { pass: 0, total: 0, cost: 0 };
      agg.total += 1;
      if (pass) agg.pass += 1;
      agg.cost += meter.cost ?? 0;
      summary.set(effort, agg);
      console.log(
        `${effort.padEnd(6)} ${task.id.padEnd(12)} trial ${trial}: ${pass ? "PASS" : "FAIL"}  ($${(meter.cost ?? 0).toFixed(4)}, ${meter.requests} reqs)`,
      );
    }
  }
}

console.log("\neffort   pass-rate   est-cost");
for (const [effort, agg] of summary) {
  console.log(
    `${effort.padEnd(8)} ${agg.pass}/${agg.total}        $${agg.cost.toFixed(4)}`,
  );
}
console.log(`\nresults: ${RESULTS} (n=${TRIALS} per cell — small; state variance honestly)`);
