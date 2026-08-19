import type { TelemetryRecord } from "./telemetry.js";

/**
 * Aggregate the JSONL telemetry into a terminal report (plan E4.3).
 * Coverage honesty: absence of usage data is reported, never displayed as
 * absence of spend; unpriced requests are counted, not zeroed.
 */

export interface ReportOptions {
  sinceMs?: number;
  now?: () => number;
}

interface ModelAggregate {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priced: number;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function renderReport(lines: string[], options: ReportOptions = {}): string {
  const now = options.now ?? Date.now;
  const cutoff = options.sinceMs === undefined ? undefined : now() - options.sinceMs;

  const records: TelemetryRecord[] = [];
  let malformed = 0;
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as TelemetryRecord;
      if (typeof parsed.ts !== "string") throw new Error("no ts");
      if (cutoff !== undefined && Date.parse(parsed.ts) < cutoff) continue;
      records.push(parsed);
    } catch {
      malformed += 1;
    }
  }

  if (records.length === 0) {
    const note =
      malformed > 0 ? `\n(skipped ${malformed} malformed line${malformed === 1 ? "" : "s"})` : "";
    return (
      "effortd report: no telemetry recorded yet" +
      (cutoff !== undefined ? " in the selected window" : "") +
      ".\nRun `effortd start` and point an agent's base URL at it; every inference request lands here." +
      note
    );
  }

  const byModel = new Map<string, ModelAggregate>();
  const byEffort = new Map<string, number>();
  const sessions = new Set<string>();
  let withUsage = 0;
  let unpriced = 0;
  let wouldHave = 0;
  let mutated = 0;
  let totalCost = 0;

  for (const record of records) {
    const aggregate = byModel.get(record.model) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      priced: 0,
    };
    aggregate.requests += 1;
    if (record.usage) {
      withUsage += 1;
      aggregate.inputTokens += record.usage.inputTokens ?? 0;
      aggregate.outputTokens += record.usage.outputTokens ?? 0;
    }
    if (record.costUsd !== null && record.costUsd !== undefined) {
      aggregate.costUsd += record.costUsd;
      aggregate.priced += 1;
      totalCost += record.costUsd;
    }
    if (record.unpriced === true) unpriced += 1;
    byModel.set(record.model, aggregate);

    const effort =
      record.appliedEffort ?? record.requestedEffort ?? "(none)";
    byEffort.set(effort, (byEffort.get(effort) ?? 0) + 1);
    if (record.sessionFingerprint) sessions.add(record.sessionFingerprint);
    if (record.wouldHaveEffort !== undefined) wouldHave += 1;
    if (record.appliedEffort !== undefined) mutated += 1;
  }

  const out: string[] = [];
  out.push("effortd report");
  out.push("==============");
  out.push(`requests: ${records.length}   sessions: ${sessions.size}`);
  out.push(
    `usage coverage: ${withUsage}/${records.length} requests carried usage data` +
      (withUsage < records.length
        ? " — missing rows are unknown spend, not zero"
        : ""),
  );
  out.push(
    `estimated cost (priced rows only): ${formatUsd(totalCost)}   unpriced: ${unpriced}`,
  );
  out.push(
    `policy: ${mutated} mutated, would-have decisions: ${wouldHave} (observe/suggest)`,
  );
  out.push("");
  out.push("by model:");
  for (const [model, aggregate] of [...byModel.entries()].sort(
    (a, b) => b[1].requests - a[1].requests,
  )) {
    out.push(
      `  ${model.padEnd(28)} req ${String(aggregate.requests).padStart(4)}   in ${String(aggregate.inputTokens).padStart(9)}   out ${String(aggregate.outputTokens).padStart(8)}   ${formatUsd(aggregate.costUsd)}${aggregate.priced < aggregate.requests ? " (partial pricing)" : ""}`,
    );
  }
  out.push("");
  out.push("by effort (applied, else requested):");
  for (const [effort, count] of [...byEffort.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    out.push(`  ${effort.padEnd(10)} ${count}`);
  }
  if (malformed > 0) {
    out.push("");
    out.push(`skipped ${malformed} malformed line${malformed === 1 ? "" : "s"}`);
  }
  return out.join("\n");
}

export function parseSince(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)([hdm])$/.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  const msPerUnit =
    unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 60_000;
  return amount * msPerUnit;
}
