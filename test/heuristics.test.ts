import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { suggestEffort } from "../src/heuristics.js";
import { createEffortdHooks } from "../src/pipeline.js";
import { createGateway } from "../src/server.js";
import { SessionStore } from "../src/session.js";
import type { TelemetryRecord, TelemetrySink } from "../src/telemetry.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { address, port } = server.address() as AddressInfo;
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return `http://${address}:${port}`;
}

describe("E5.1 heuristic signals", () => {
  it("suggests low for short trivial asks", () => {
    for (const text of [
      "fix the typo in the README",
      "rename getUser to fetchUser",
      "bump the version and run the formatter",
    ]) {
      expect(suggestEffort(text)?.suggested).toBe("low");
    }
  });

  it("suggests xhigh on hard signals", () => {
    for (const text of [
      "debug the intermittent race condition in the job queue",
      "why is the memory usage growing over time?",
      "design the migration plan for the auth schema",
    ]) {
      expect(suggestEffort(text)?.suggested).toBe("xhigh");
    }
  });

  it("suggests xhigh for very long or code-heavy openers", () => {
    expect(suggestEffort("x".repeat(2000))?.suggested).toBe("xhigh");
    expect(
      suggestEffort("look at this\n```js\na\n```\nand this\n```js\nb\n```")
        ?.suggested,
    ).toBe("xhigh");
  });

  it("has no opinion on ordinary asks, and hard beats trivial", () => {
    expect(suggestEffort("add a logout button to the settings page")).toBeUndefined();
    expect(
      suggestEffort("fix the typo that causes the race condition")?.suggested,
    ).toBe("xhigh");
  });

  it("names its signals", () => {
    const result = suggestEffort("debug the flaky test");
    expect(result?.signals.join(" ")).toMatch(/hard-signal/);
  });
});

describe("E5.1/E5.2 suggestions through the pipeline", () => {
  async function run(
    config = DEFAULT_CONFIG,
    opener = "fix the typo in the README",
    requestedEffort: string | undefined = "high",
  ): Promise<{ records: TelemetryRecord[]; forwarded: Buffer[] }> {
    const forwarded: Buffer[] = [];
    const upstream = await listen(
      http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          forwarded.push(Buffer.concat(chunks));
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        });
      }),
    );
    const records: TelemetryRecord[] = [];
    const sink: TelemetrySink = { path: "(memory)", write: (r) => records.push(r) };
    const gateway = await listen(
      createGateway({
        mounts: { "/anthropic": upstream },
        hooks: createEffortdHooks({
          config,
          store: new SessionStore(),
          mountAdapters: { "/anthropic": "anthropic" },
          sink,
        }),
      }),
    );
    const body = JSON.stringify({
      model: "claude-opus-5",
      ...(requestedEffort ? { output_config: { effort: requestedEffort } } : {}),
      messages: [{ role: "user", content: opener }],
    });
    await fetch(`${gateway}/anthropic/v1/messages`, { method: "POST", body });
    await fetch(`${gateway}/anthropic/v1/messages`, { method: "POST", body });
    return { records, forwarded };
  }

  it("records a session-start suggestion once, inert in suggest mode", async () => {
    const { records, forwarded } = await run({
      ...DEFAULT_CONFIG,
      mode: "suggest",
    });
    expect(records[0]!.suggestion).toBe("low");
    expect(records[1]!.suggestion).toBeUndefined(); // session already known
    // inert: bytes unchanged
    expect(forwarded[0]!.toString()).toContain('"effort":"high"');
    expect(records[0]!.appliedEffort).toBeUndefined();
  });

  it("stays silent when suggest.enabled is off", async () => {
    const { records } = await run({
      ...DEFAULT_CONFIG,
      mode: "suggest",
      suggest: { enabled: false, escalateOnSuggestion: false },
    });
    expect(records[0]!.suggestion).toBeUndefined();
  });

  it("E5.2: the enforce ratchet raises effort on hard signals, one way only", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      mode: "enforce" as const,
      suggest: { enabled: true, escalateOnSuggestion: true },
    };
    const hard = await run(
      config,
      "debug the intermittent race condition in the queue",
      "medium",
    );
    const first = JSON.parse(hard.forwarded[0]!.toString()) as {
      output_config: { effort: string };
    };
    expect(first.output_config.effort).toBe("xhigh");
    expect(hard.records[0]!.appliedEffort).toBe("xhigh");

    // trivial suggestion must never lower a request
    const trivial = await run(config, "fix the typo in the README", "high");
    expect(trivial.records[0]!.appliedEffort).toBeUndefined();
    expect(trivial.forwarded[0]!.toString()).toContain('"effort":"high"');
  });
});
