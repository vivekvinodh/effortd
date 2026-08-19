import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../src/server.js";

type UpstreamHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
) => void;

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

async function fakeUpstream(handler: UpstreamHandler): Promise<string> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => handler(req, res, Buffer.concat(chunks)));
  });
  return listen(server);
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("E1.1 transparent passthrough", () => {
  it("forwards method, path, query, headers, and body bytes to the mounted upstream", async () => {
    const upstream = await fakeUpstream((req, res, body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          bodyHash: sha256(body),
        }),
      );
    });
    const gateway = await listen(
      createGateway({ mounts: { "/anthropic": upstream } }),
    );

    const body = JSON.stringify({ model: "claude-opus-5", max_tokens: 8 });
    const response = await fetch(
      `${gateway}/anthropic/v1/messages?beta=true`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "sk-test-123",
          "anthropic-beta": "oauth-2025-04-20",
        },
        body,
      },
    );
    const echoed = (await response.json()) as {
      method: string;
      url: string;
      headers: Record<string, string>;
      bodyHash: string;
    };

    expect(response.status).toBe(200);
    expect(echoed.method).toBe("POST");
    expect(echoed.url).toBe("/v1/messages?beta=true");
    expect(echoed.bodyHash).toBe(sha256(Buffer.from(body)));
    expect(echoed.headers["x-api-key"]).toBe("sk-test-123");
    expect(echoed.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(echoed.headers["accept-encoding"]).toBe("identity");
    expect(echoed.headers["host"]).toBe(new URL(upstream).host);
  });

  it("returns upstream status, headers, and binary body byte-for-byte", async () => {
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(418, {
        "content-type": "application/octet-stream",
        "x-upstream-marker": "teapot",
      });
      res.end(payload);
    });
    const gateway = await listen(
      createGateway({ mounts: { "/openai": upstream } }),
    );

    const response = await fetch(`${gateway}/openai/v1/blob`);
    const received = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(418);
    expect(response.headers.get("x-upstream-marker")).toBe("teapot");
    expect(sha256(received)).toBe(sha256(payload));
  });

  it("streams SSE through incrementally without buffering (chunk-timing tripwire)", async () => {
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        sent += 1;
        res.write(`event: tick\ndata: {"n":${sent}}\n\n`);
        if (sent === 3) {
          clearInterval(timer);
          res.end();
        }
      }, 40);
    });
    const gateway = await listen(
      createGateway({ mounts: { "/anthropic": upstream } }),
    );

    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "{}",
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const arrivals: number[] = [];
    let text = "";
    for await (const chunk of response.body!) {
      arrivals.push(Date.now());
      text += Buffer.from(chunk).toString("utf8");
    }

    expect(text).toContain('data: {"n":1}');
    expect(text).toContain('data: {"n":3}');
    expect(arrivals.length).toBeGreaterThanOrEqual(3);
    expect(arrivals[arrivals.length - 1]! - arrivals[0]!).toBeGreaterThanOrEqual(60);
  });

  it("404s unknown mounts with a help body naming the available mounts", async () => {
    const gateway = await listen(
      createGateway({ mounts: { "/anthropic": "http://127.0.0.1:9" } }),
    );
    const response = await fetch(`${gateway}/unknown/v1/thing`);
    const parsed = (await response.json()) as { error: { mounts: string[] } };

    expect(response.status).toBe(404);
    expect(parsed.error.mounts).toContain("/anthropic");
  });

  it("serves a health page at / naming the service and mounts", async () => {
    const gateway = await listen(
      createGateway({ mounts: { "/gemini": "http://127.0.0.1:9" } }),
    );
    const response = await fetch(`${gateway}/`);
    const parsed = (await response.json()) as {
      service: string;
      mounts: string[];
    };

    expect(response.status).toBe(200);
    expect(parsed.service).toBe("effortd");
    expect(parsed.mounts).toEqual(["/gemini"]);
  });

  it("rejects request bodies over the cap with 413 without calling the upstream", async () => {
    let upstreamCalled = false;
    const upstream = await fakeUpstream((_req, res) => {
      upstreamCalled = true;
      res.end("ok");
    });
    const gateway = await listen(
      createGateway({ mounts: { "/anthropic": upstream }, maxBodyBytes: 1024 }),
    );

    const response = await fetch(`${gateway}/anthropic/v1/messages`, {
      method: "POST",
      body: "x".repeat(4096),
    });

    expect(response.status).toBe(413);
    expect(upstreamCalled).toBe(false);
  });
});
