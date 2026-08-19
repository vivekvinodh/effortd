import type { EffortdConfig } from "./config.js";
import { decide, type Decision, type DecisionInput } from "./policy.js";
import { anthropic } from "./providers/anthropic.js";
import { gemini } from "./providers/gemini.js";
import { openai } from "./providers/openai.js";
import type { ProviderAdapter } from "./providers/types.js";
import { SessionStore } from "./session.js";
import { fingerprintFor } from "./session.js";
import type { Effort } from "./effort.js";
import { estimateCostUsd, priceFor } from "./pricing.js";
import type { GatewayHooks, RequestInfo } from "./server.js";
import type { TelemetryRecord, TelemetrySink } from "./telemetry.js";
import { createUsageExtractor } from "./usage.js";

/**
 * Wires config + adapters + sessions + the decision core into GatewayHooks
 * (plan E3.4). Everything here rides inside the gateway's fail-open wrapper;
 * a throw anywhere forwards the request untouched.
 */

export const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic,
  openai,
  gemini,
};

export interface DecisionRecord {
  provider: string;
  model: string;
  /** Path with the query string stripped (privacy floor: `?key=` must never surface). */
  path: string;
  requestedEffort?: Effort;
  decision: Decision;
  sessionFingerprint?: string;
}

export interface PipelineDeps {
  config: EffortdConfig;
  store: SessionStore;
  /** mount → adapter name, e.g. { "/anthropic": "anthropic" }. */
  mountAdapters: Record<string, keyof typeof ADAPTERS>;
  onDecision?: (record: DecisionRecord, info?: RequestInfo) => void;
  /** E5 seam: session-start suggestion source. */
  suggestFor?: (info: RequestInfo, body: unknown) => Effort | undefined;
}

export function createPolicyHooks(deps: PipelineDeps): GatewayHooks {
  const { config, store } = deps;

  return {
    rewriteRequestBody(info) {
      const adapterName = deps.mountAdapters[info.mount];
      const adapter = adapterName === undefined ? undefined : ADAPTERS[adapterName];
      if (!adapter || !adapter.isInferencePath(info.path)) return undefined;

      let body: unknown;
      try {
        body = JSON.parse(info.body.toString("utf8"));
      } catch {
        return undefined; // fail-open: not ours to fix
      }

      const model = adapter.getModel(body, info.path);
      if (model === undefined) return undefined;

      const requested = adapter.readEffort(body);
      const fingerprint = fingerprintFor(adapter.name, body);
      const session =
        fingerprint === undefined ? undefined : store.get(fingerprint);

      const input: DecisionInput = {
        mode: config.mode,
        inject: config.inject,
        sessionSticky: config.sessionSticky,
        escalateOnly: config.escalateOnly,
        canInject: adapter.canInject(model),
        escalateOnSuggestion: config.suggest.escalateOnSuggestion,
      };
      if (config.floor !== undefined) input.floor = config.floor;
      if (config.ceiling !== undefined) input.ceiling = config.ceiling;
      if (config.defaultEffort !== undefined) {
        input.defaultEffort = config.defaultEffort;
      }
      if (requested !== undefined) input.requestedEffort = requested;
      if (session?.effort !== undefined) input.sessionEffort = session.effort;
      if (config.suggest.enabled && deps.suggestFor) {
        const suggestion = deps.suggestFor(info, body);
        if (suggestion !== undefined) input.suggestion = suggestion;
      }

      const decision = decide(input);

      if (fingerprint !== undefined) {
        store.record(fingerprint, decision.sessionEffortNext);
      }

      const record: DecisionRecord = {
        provider: adapter.name,
        model,
        path: info.path.split("?")[0]!,
        decision,
      };
      if (requested !== undefined) record.requestedEffort = requested;
      if (fingerprint !== undefined) record.sessionFingerprint = fingerprint;
      deps.onDecision?.(record, info);

      if (decision.applied === undefined) return undefined;

      // Capability mapping may land on what the request already says — skip the write.
      const planned = adapter.planEffort(model, decision.applied);
      if (planned === undefined || planned === requested) return undefined;

      const rewritten = adapter.applyEffort(body, decision.applied, info.path);
      if (rewritten === undefined) return undefined;
      return Buffer.from(JSON.stringify(rewritten), "utf8");
    },
  };
}

export interface EffortdHooksDeps extends PipelineDeps {
  /** JSONL (or in-memory) telemetry sink; omit to disable telemetry. */
  sink?: TelemetrySink;
  /** Redacted access-log line per response (query strings pre-stripped). */
  onAccess?: (line: string) => void;
}

/**
 * The full production hook set: policy rewrite + telemetry tap + access log
 * (plan E4.2). Decision↔response correlation rides the RequestInfo identity
 * the gateway passes to both hooks.
 */
export function createEffortdHooks(deps: EffortdHooksDeps): GatewayHooks {
  const decisions = new WeakMap<RequestInfo, DecisionRecord>();
  const policy = createPolicyHooks({
    ...deps,
    onDecision: (record, info) => {
      if (info) decisions.set(info, record);
      deps.onDecision?.(record, info);
    },
  });

  return {
    rewriteRequestBody: policy.rewriteRequestBody!,

    tapResponse(info, res) {
      const pathSansQuery = info.path.split("?")[0]!;
      deps.onAccess?.(
        `${info.method} ${info.mount}${pathSansQuery}${
          info.path.includes("?") ? "?…" : ""
        } -> ${res.status}`,
      );

      if (!deps.sink) return undefined;
      const adapterName = deps.mountAdapters[info.mount];
      const adapter =
        adapterName === undefined ? undefined : ADAPTERS[adapterName];
      if (!adapter || !adapter.isInferencePath(info.path)) return undefined;

      const decision = decisions.get(info);
      const extractor = createUsageExtractor(
        adapter.name,
        res.headers.get("content-type"),
      );
      return {
        chunk(data) {
          extractor.chunk(data);
        },
        end: () => {
          const usage = extractor.final();
          const model =
            decision?.model ?? modelFromRawBody(adapter, info) ?? "(unknown)";
          const price = priceFor(model, deps.config.pricing);
          const record: TelemetryRecord = {
            ts: new Date().toISOString(),
            provider: adapter.name,
            model,
            path: pathSansQuery,
            mode: deps.config.mode,
            action: decision?.decision.action ?? "untouched",
            reason:
              decision?.decision.reason ??
              "no decision (unparseable or model-less request)",
            status: res.status,
            usage,
            costUsd: usage !== null && price ? estimateCostUsd(usage, price) : null,
          };
          if (price === undefined) record.unpriced = true;
          if (decision?.requestedEffort !== undefined) {
            record.requestedEffort = decision.requestedEffort;
          }
          if (decision?.decision.applied !== undefined) {
            record.appliedEffort = decision.decision.applied;
          }
          if (decision?.decision.wouldHave !== undefined) {
            record.wouldHaveEffort = decision.decision.wouldHave;
          }
          if (decision?.sessionFingerprint !== undefined) {
            record.sessionFingerprint = decision.sessionFingerprint;
          }
          deps.sink!.write(record);
        },
      };
    },
  };
}

function modelFromRawBody(
  adapter: ProviderAdapter,
  info: RequestInfo,
): string | undefined {
  try {
    return adapter.getModel(JSON.parse(info.body.toString("utf8")), info.path);
  } catch {
    return undefined;
  }
}
