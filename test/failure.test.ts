import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGateway, type GatewayOptions } from "../src/server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()!();
  }
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { address, port } = server.address() as AddressInfo;
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return `http://${address}:${port}`;
}

async function fakeUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void,
): Promise<string> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => handler(req, res, Buffer.concat(chunks)));
  });
  return listen(server);
}

async function gatewayFor(
  upstream: string,
  extra?: Partial<GatewayOptions>,
): Promise<string> {
  return listen(
    createGateway({
      mounts: { "/anthropic": upstream },
      onInternalError: () => {},
      ...extra,
    }),
  );
}

describe("E1.2 failure semantics", () => {
  it("passes upstream error responses through verbatim (status, headers, body)", async () => {
    const errorBody = JSON.stringify({
      type: "error",
      error: { type: "rate_limit_error", message: "slow down" },
    });
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "17",
      });
      res.end(errorBody);
    });
    const gateway = await gatewayFor(upstream);

    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(await response.text()).toBe(errorBody);
  });

  it("answers 502 with an effortd-identifying body when the upstream is unreachable", async () => {
    const gateway = await gatewayFor("http://127.0.0.1:9");

    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "{}",
    });
    const parsed = (await response.json()) as { error: { type: string } };

    expect(response.status).toBe(502);
    expect(parsed.error.type).toBe("effortd_upstream_unreachable");
  });

  it("fail-open: a throwing rewrite hook forwards the original body untouched", async () => {
    let received = "";
    const upstream = await fakeUpstream((_req, res, body) => {
      received = body.toString("utf8");
      res.end("ok");
    });
    const stages: string[] = [];
    const gateway = await gatewayFor(upstream, {
      hooks: {
        rewriteRequestBody: () => {
          throw new Error("poisoned policy stage");
        },
      },
      onInternalError: (stage) => stages.push(stage),
    });

    const original = '{"model":"claude-opus-5","not-even-valid-json"';
    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: original,
    });

    expect(response.status).toBe(200);
    expect(received).toBe(original);
    expect(stages).toContain("rewriteRequestBody");
  });

  it("fail-open: a tap that throws mid-stream never affects the client's bytes", async () => {
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        sent += 1;
        res.write(`data: {"n":${sent}}\n\n`);
        if (sent === 4) {
          clearInterval(timer);
          res.end();
        }
      }, 20);
    });
    let tapCalls = 0;
    const gateway = await gatewayFor(upstream, {
      hooks: {
        tapResponse: () => ({
          chunk: () => {
            tapCalls += 1;
            if (tapCalls === 2) throw new Error("tap died mid-stream");
          },
          end: () => {},
        }),
      },
    });

    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "{}",
    });
    const text = await response.text();

    expect(text).toContain('data: {"n":1}');
    expect(text).toContain('data: {"n":4}');
    expect(tapCalls).toBe(2); // died on 2, never called again, stream unaffected
  });

  it("propagates a client abort to the upstream within 1s", async () => {
    let upstreamClosedAt = 0;
    let firstChunkAt = 0;
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      firstChunkAt = Date.now();
      const timer = setInterval(() => res.write("data: tick\n\n"), 100);
      res.on("close", () => {
        clearInterval(timer);
        upstreamClosedAt = Date.now();
      });
    });
    const gateway = await gatewayFor(upstream);

    const abort = new AbortController();
    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "{}",
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();

    await vi.waitFor(() => expect(upstreamClosedAt).toBeGreaterThan(0), {
      timeout: 2000,
    });
    expect(upstreamClosedAt - firstChunkAt).toBeLessThanOrEqual(1000);
  });
});
