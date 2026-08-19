import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createEffortdHooks } from "../src/pipeline.js";
import { DEFAULT_PRICES, estimateCostUsd, priceFor } from "../src/pricing.js";
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

describe("E4.2 pricing", () => {
  it("prices known models, tolerating provider-prefixed ids", () => {
    expect(priceFor("claude-opus-5", {})).toEqual({ input: 5, output: 25 });
    expect(priceFor("us.anthropic.claude-opus-5-v1:0", {})).toEqual({
      input: 5,
      output: 25,
    });
    expect(priceFor("gpt-5.5", {})).toBeUndefined(); // no unverified defaults
    expect(priceFor("gpt-5.5", { "gpt-5.5": { input: 2, output: 8 } })).toEqual({
      input: 2,
      output: 8,
    });
  });

  it("computes cost including cache economics, matching hand-computed numbers", () => {
    // opus-5: (2*5 + 4*25 + 53643*0.1*5 + 17234*1.25*5)/1e6
    const cost = estimateCostUsd(
      {
        inputTokens: 2,
        outputTokens: 4,
        cacheReadTokens: 53_643,
        cacheWriteTokens: 17_234,
      },
      DEFAULT_PRICES["claude-opus-5"]!,
    );
    expect(cost).toBeCloseTo((10 + 100 + 26_821.5 + 107_712.5) / 1e6, 10);
  });
});

describe("E4.2 telemetry through the gateway", () => {
  it("writes one metadata-only record per inference request; secrets never land", async () => {
    const upstream = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg",
            usage: { input_tokens: 1000, output_tokens: 500 },
          }),
        );
      }),
    );

    const written: TelemetryRecord[] = [];
    const sink: TelemetrySink = {
      path: "(memory)",
      write: (record) => written.push(record),
    };
    const gateway = await listen(
      createGateway({
        mounts: { "/anthropic": upstream },
        hooks: createEffortdHooks({
          config: { ...DEFAULT_CONFIG, mode: "observe", ceiling: "medium" },
          store: new SessionStore(),
          mountAdapters: { "/anthropic": "anthropic" },
          sink,
        }),
      }),
    );

    await fetch(`${gateway}/anthropic/v1/messages?beta=true`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "sk-SECRET_HEADER_MARKER",
      },
      body: JSON.stringify({
        model: "claude-opus-5",
        output_config: { effort: "max" },
        system: "SECRET_SYSTEM_MARKER",
        messages: [{ role: "user", content: "SECRET_BODY_MARKER" }],
      }),
    });
    // non-inference traffic produces no telemetry
    await fetch(`${gateway}/anthropic/v1/models`);

    expect(written).toHaveLength(1);
    const record = written[0]!;
    expect(record.provider).toBe("anthropic");
    expect(record.model).toBe("claude-opus-5");
    expect(record.path).toBe("/v1/messages"); // query stripped
    expect(record.status).toBe(200);
    expect(record.requestedEffort).toBe("max");
    expect(record.wouldHaveEffort).toBe("medium");
    expect(record.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(record.costUsd).toBeCloseTo((1000 * 5 + 500 * 25) / 1e6, 10);
    expect(record.sessionFingerprint).toMatch(/^[0-9a-f]{16}$/);

    const serialized = JSON.stringify(written);
    expect(serialized).not.toContain("SECRET_HEADER_MARKER");
    expect(serialized).not.toContain("SECRET_SYSTEM_MARKER");
    expect(serialized).not.toContain("SECRET_BODY_MARKER");
  });

  it("marks unknown models unpriced with null cost — never $0", async () => {
    const upstream = await listen(
      http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 } }),
        );
      }),
    );
    const written: TelemetryRecord[] = [];
    const gateway = await listen(
      createGateway({
        mounts: { "/openai": upstream },
        hooks: createEffortdHooks({
          config: DEFAULT_CONFIG,
          store: new SessionStore(),
          mountAdapters: { "/openai": "openai" },
          sink: { path: "(memory)", write: (r) => written.push(r) },
        }),
      }),
    );

    await fetch(`${gateway}/openai/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
    });

    expect(written).toHaveLength(1);
    expect(written[0]!.usage).toEqual({ inputTokens: 10, outputTokens: 10 });
    expect(written[0]!.costUsd).toBeNull();
    expect(written[0]!.unpriced).toBe(true);
  });
});
