import http from "node:http";

/**
 * Transport core. Invariants (docs/DESIGN.md — "prime invariant"):
 * - fail-open: hook errors are swallowed and the request/response proceeds untouched;
 * - responses stream through unbuffered, chunk-for-chunk;
 * - the only place effortd speaks for itself is transport failure (502) and its own
 *   help/404 pages — upstream responses, including errors, pass through verbatim.
 */

export interface ResponseTap {
  chunk(data: Buffer): void;
  end(): void;
}

export interface RequestInfo {
  mount: string;
  path: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface ResponseInfo {
  mount: string;
  path: string;
  status: number;
  headers: Headers;
}

export interface GatewayHooks {
  /** Return a replacement body, or undefined to forward unchanged. Errors → unchanged. */
  rewriteRequestBody?: (info: RequestInfo) => Buffer | undefined;
  /** Return a tap to observe response bytes, or undefined. Tap errors never affect the client. */
  tapResponse?: (req: RequestInfo, res: ResponseInfo) => ResponseTap | undefined;
}

export interface GatewayOptions {
  /** mount path → upstream origin, e.g. { "/anthropic": "https://api.anthropic.com" } */
  mounts: Record<string, string>;
  maxBodyBytes?: number;
  hooks?: GatewayHooks;
  /** Diagnostic sink for swallowed internal errors. Defaults to console.error. */
  onInternalError?: (stage: string, error: unknown) => void;
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Hop-by-hop / transport headers that must not be forwarded upstream. */
const REQUEST_STRIP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
  "expect",
]);

const RESPONSE_STRIP = new Set(["connection", "keep-alive", "transfer-encoding"]);

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

class PayloadTooLargeError extends Error {}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        // Stop buffering but keep draining, so the 413 can be written and read.
        req.removeAllListeners("data");
        req.on("data", () => {});
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });
}

function buildUpstreamHeaders(incoming: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || REQUEST_STRIP.has(name)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  // Forced so response bytes are plaintext for taps; bodies still stream through verbatim.
  headers.set("accept-encoding", "identity");
  return headers;
}

function buildClientHeaders(upstream: Headers): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  upstream.forEach((value, name) => {
    if (RESPONSE_STRIP.has(name) || name === "set-cookie") return;
    out[name] = value;
  });
  const cookies = upstream.getSetCookie();
  if (cookies.length > 0) out["set-cookie"] = cookies;
  return out;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function createGateway(options: GatewayOptions): http.Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const mounts = Object.entries(options.mounts);
  const reportError =
    options.onInternalError ??
    ((stage: string, error: unknown) =>
      console.error(`effortd internal error [${stage}]:`, error));

  async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (url === "/" || url === "/healthz") {
      sendJson(res, 200, {
        service: "effortd",
        mounts: mounts.map(([mount]) => mount),
      });
      return;
    }

    const matched = mounts.find(
      ([mount]) => url === mount || url.startsWith(`${mount}/`),
    );
    if (!matched) {
      sendJson(res, 404, {
        error: {
          type: "effortd_unknown_mount",
          message: `no mount matches ${url}; point your agent's base URL at one of the mounts`,
          mounts: mounts.map(([mount]) => mount),
        },
      });
      return;
    }
    const [mount, upstreamOrigin] = matched;
    const path = url.slice(mount.length) || "/";

    let body: Buffer;
    try {
      body = await readBody(req, maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(res, 413, {
          error: {
            type: "effortd_payload_too_large",
            message: `request body exceeds ${maxBodyBytes} bytes`,
          },
        });
      }
      return;
    }

    const requestInfo: RequestInfo = {
      mount,
      path,
      method,
      headers: req.headers,
      body,
    };

    let outboundBody = body;
    if (options.hooks?.rewriteRequestBody) {
      try {
        const rewritten = options.hooks.rewriteRequestBody(requestInfo);
        if (rewritten !== undefined) outboundBody = rewritten;
      } catch (error) {
        reportError("rewriteRequestBody", error); // fail-open: forward unchanged
      }
    }

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    const init: RequestInit = {
      method,
      headers: buildUpstreamHeaders(req.headers),
      redirect: "manual",
      signal: abort.signal,
    };
    if (!BODYLESS_METHODS.has(method) && outboundBody.length > 0) {
      init.body = new Uint8Array(outboundBody);
    }

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(`${upstreamOrigin}${path}`, init);
    } catch (error) {
      if (abort.signal.aborted) return; // client went away; nothing to answer
      sendJson(res, 502, {
        error: {
          type: "effortd_upstream_unreachable",
          message: `could not reach ${upstreamOrigin}: ${String(error)}`,
        },
      });
      return;
    }

    res.writeHead(
      upstreamResponse.status,
      buildClientHeaders(upstreamResponse.headers),
    );

    let tap: ResponseTap | undefined;
    if (options.hooks?.tapResponse) {
      try {
        tap = options.hooks.tapResponse(requestInfo, {
          mount,
          path,
          status: upstreamResponse.status,
          headers: upstreamResponse.headers,
        });
      } catch (error) {
        reportError("tapResponse", error);
      }
    }

    if (upstreamResponse.body) {
      try {
        for await (const chunk of upstreamResponse.body) {
          const data = Buffer.from(chunk);
          res.write(data);
          if (tap) {
            try {
              tap.chunk(data);
            } catch (error) {
              reportError("tap.chunk", error);
              tap = undefined; // a broken tap stays broken; the stream must not
            }
          }
        }
      } catch (error) {
        if (!abort.signal.aborted) reportError("stream", error);
        res.destroy();
        return;
      }
    }
    if (tap) {
      try {
        tap.end();
      } catch (error) {
        reportError("tap.end", error);
      }
    }
    res.end();
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      reportError("handle", error);
      if (!res.headersSent) {
        sendJson(res, 502, {
          error: { type: "effortd_gateway_error", message: String(error) },
        });
      } else {
        res.destroy();
      }
    });
  });
}
