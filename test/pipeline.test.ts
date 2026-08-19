import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type EffortdConfig } from "../src/config.js";
import { createPolicyHooks, type DecisionRecord } from "../src/pipeline.js";
import { SessionStore } from "../src/session.js";
import { createGateway } from "../src/server.js";

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

interface Harness {
  gateway: string;
  received: Buffer[];
  decisions: DecisionRecord[];
}

async function harness(config: EffortdConfig): Promise<Harness> {
  const received: Buffer[] = [];
  const decisions: DecisionRecord[] = [];
  const upstreamServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  const upstream = await listen(upstreamServer);
  const hooks = createPolicyHooks({
    config,
    store: new SessionStore(),
    mountAdapters: { "/anthropic": "anthropic", "/gemini": "gemini" },
    onDecision: (record) => decisions.push(record),
  });
  const gateway = await listen(
    createGateway({
      mounts: { "/anthropic": upstream, "/gemini": upstream },
      hooks,
    }),
  );
  return { gateway, received, decisions };
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const opusBody = (effort?: string) =>
  JSON.stringify({
    model: "claude-opus-5",
    max_tokens: 32,
    ...(effort ? { output_config: { effort } } : {}),
    system: "agent",
    messages: [{ role: "user", content: "task one" }],
  });

async function post(gateway: string, path: string, body: string): Promise<void> {
  await fetch(`${gateway}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("E3.4 policy wired into the proxy", () => {
  it("observe mode is byte-identical even when enforce would clamp", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "observe", ceiling: "medium" });
    const body = opusBody("max");
    await post(h.gateway, "/anthropic/v1/messages", body);

    expect(sha256(h.received[0]!)).toBe(sha256(Buffer.from(body)));
    expect(h.decisions[0]!.decision.wouldHave).toBe("medium");
    expect(h.decisions[0]!.decision.applied).toBeUndefined();
  });

  it("enforce clamps to the ceiling, changing exactly the effort field", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce", ceiling: "medium" });
    await post(h.gateway, "/anthropic/v1/messages", opusBody("max"));

    const forwarded = JSON.parse(h.received[0]!.toString("utf8")) as Record<string, unknown>;
    const original = JSON.parse(opusBody("max")) as Record<string, unknown>;
    expect((forwarded["output_config"] as { effort: string }).effort).toBe("medium");
    (forwarded["output_config"] as { effort: string }).effort = "max";
    expect(forwarded).toEqual(original);
  });

  it("enforce injects the default only on allowlisted models", async () => {
    const config: EffortdConfig = {
      ...DEFAULT_CONFIG,
      mode: "enforce",
      inject: true,
      defaultEffort: "high",
    };
    const h = await harness(config);
    await post(h.gateway, "/anthropic/v1/messages", opusBody());
    const injected = JSON.parse(h.received[0]!.toString("utf8")) as {
      output_config?: { effort?: string };
    };
    expect(injected.output_config?.effort).toBe("high");

    const haiku = JSON.stringify({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "task one" }],
    });
    await post(h.gateway, "/anthropic/v1/messages", haiku);
    expect(sha256(h.received[1]!)).toBe(sha256(Buffer.from(haiku)));
  });

  it("leaves non-inference paths untouched even with effort-bearing bodies", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce", ceiling: "low" });
    const body = opusBody("max");
    await post(h.gateway, "/anthropic/v1/messages/count_tokens", body);

    expect(sha256(h.received[0]!)).toBe(sha256(Buffer.from(body)));
    expect(h.decisions).toHaveLength(0);
  });

  it("holds a sticky session across requests", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce" });
    await post(h.gateway, "/anthropic/v1/messages", opusBody("medium"));
    await post(h.gateway, "/anthropic/v1/messages", opusBody("low"));

    const second = JSON.parse(h.received[1]!.toString("utf8")) as {
      output_config: { effort: string };
    };
    expect(second.output_config.effort).toBe("medium");
    expect(h.decisions[1]!.decision.action).toBe("sticky-held");
  });

  it("skips the write when capability mapping lands on the requested value", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce", floor: "xhigh" });
    const body = JSON.stringify({
      model: "claude-sonnet-4-6", // xhigh maps down to high on the 4.6 pair
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "task one" }],
    });
    await post(h.gateway, "/anthropic/v1/messages", body);

    expect(sha256(h.received[0]!)).toBe(sha256(Buffer.from(body)));
  });

  it("leaves gemini budget-style requests untouched", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce", ceiling: "low" });
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 8192 } },
    });
    await post(
      h.gateway,
      "/gemini/v1beta/models/gemini-2.5-pro:generateContent",
      body,
    );

    expect(sha256(h.received[0]!)).toBe(sha256(Buffer.from(body)));
  });

  it("forwards malformed JSON raw (fail-open) even in enforce mode", async () => {
    const h = await harness({ ...DEFAULT_CONFIG, mode: "enforce", ceiling: "low" });
    const body = '{"model":"claude-opus-5","output_config":{"effort":"max"';
    await post(h.gateway, "/anthropic/v1/messages", body);

    expect(sha256(h.received[0]!)).toBe(sha256(Buffer.from(body)));
  });
});
