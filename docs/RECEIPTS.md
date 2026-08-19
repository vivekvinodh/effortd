# Receipts — cost vs. success across effort levels

**What this is**: the measured basis for effortd's default policy posture (observe-first, escalate-only enforcement). **What this is not**: a benchmark of real coding work. Read the caveats before the numbers.

- **Run**: 2026-08-19, `eval/run.mjs`, executed by real Claude Code (`claude -p`, model claude-fable-5, subscription auth) through effortd in observe mode; effortd's own telemetry was the cost meter.
- **Matrix**: 3 tasks × 4 effort levels (`CLAUDE_CODE_EFFORT_LEVEL`) × **n=2 trials** = 24 calls. Actual estimated spend **$5.92 equivalent** (projected $9.72–$39.96; cache warming drove it down).
- **Task class: TOY** — deterministic, single-answer, self-checkable (10th Fibonacci; primes < 100; one-line string-reverse function). These bound *simple-task* behavior only and say nothing about long-horizon agentic work.

## Results

| Effort | Pass | Est. cost (cell) |
|---|---|---|
| low | 5/6 | $1.85 |
| medium | 6/6 | $1.56 |
| high | 5/6 | $0.94 |
| xhigh | 5/6 | $1.57 |

Every failure was the same task (`reverse-fn`, trial 2 at low/high/xhigh) — a *format-adherence* miss (the check `eval()`s the reply; any prose or fencing fails it), not a reasoning miss.

## Honest reading

1. **n=2 per cell: the pass-rate differences are noise.** Do not read "medium beats xhigh" from this table; read "toy tasks succeed at every effort level at comparable rates."
2. **The cost column is confounded by cache state.** Cells ran in order (low→xhigh); early calls paid prompt-cache *writes*, later calls enjoyed *reads*. Per-cell cost here reflects cache-warming order at least as much as effort. A clean design would randomize order and isolate cache state per cell — noted for the next run.
3. **What the data does support**: on easy tasks, low/medium effort is not observably worse — consistent with the design conclusion that adaptive thinking absorbs easy-task variance inside any effort ceiling ([DESIGN.md](DESIGN.md) conclusion 1). And the single low-effort-class failure mode observed (format adherence) is exactly the *silent-quality* risk class that makes automated **downgrading** dangerous ([DESIGN.md] conclusion 3).

## Defaults verdict (required by plan E7.2)

**Reaffirmed, unchanged**: `mode: observe` default; enforcement session-sticky and escalate-only. Nothing in this data justifies automated downgrades; the observed failure pattern actively argues against them. Any future default stronger than escalate-only needs a bigger-n, cache-controlled, non-toy run first.

Raw rows: `eval/results.jsonl` (per-trial pass/fail + telemetry-metered cost; no prompt or response content is stored).
