import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report.js";

const NOW = Date.parse("2026-08-18T12:00:00Z");

function line(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    ts: "2026-08-18T11:00:00Z",
    provider: "anthropic",
    model: "claude-opus-5",
    path: "/v1/messages",
    mode: "observe",
    action: "untouched",
    reason: "requested high within policy; unchanged",
    status: 200,
    usage: { inputTokens: 1000, outputTokens: 500 },
    costUsd: 0.0175,
    ...overrides,
  });
}

describe("E4.3 report", () => {
  it("aggregates totals, models, efforts, sessions, and coverage from a fixture log", () => {
    const lines = [
      line({ requestedEffort: "high", sessionFingerprint: "aaaa000000000000" }),
      line({
        requestedEffort: "max",
        wouldHaveEffort: "medium",
        action: "clamped",
        sessionFingerprint: "aaaa000000000000",
        costUsd: 0.02,
      }),
      line({
        model: "gpt-5.5",
        provider: "openai",
        usage: null,
        costUsd: null,
        unpriced: true,
        suggestion: "low",
        sessionFingerprint: "bbbb000000000000",
      }),
      "not valid json — must be skipped, not fatal",
    ];
    const report = renderReport(lines, { now: () => NOW });

    expect(report).toContain("requests: 3");
    expect(report).toContain("sessions: 2");
    expect(report).toContain("usage coverage: 2/3");
    expect(report).toContain("unpriced: 1");
    expect(report).toContain("claude-opus-5");
    expect(report).toContain("gpt-5.5");
    expect(report).toContain("$0.0375"); // 0.0175 + 0.02, hand-computed
    expect(report).toContain("would-have decisions: 1");
    expect(report).toContain("suggestions offered: 1");
    expect(report).toContain("skipped 1 malformed line");
  });

  it("honors the since filter", () => {
    const lines = [
      line({ ts: "2026-08-10T00:00:00Z" }),
      line({ ts: "2026-08-18T11:30:00Z" }),
    ];
    const report = renderReport(lines, {
      now: () => NOW,
      sinceMs: 24 * 60 * 60 * 1000,
    });
    expect(report).toContain("requests: 1");
  });

  it("guides instead of erroring on an empty log", () => {
    const report = renderReport([], { now: () => NOW });
    expect(report).toContain("no telemetry recorded yet");
    expect(report).toContain("effortd start");
  });
});
