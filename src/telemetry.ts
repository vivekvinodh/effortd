import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort } from "./effort.js";
import type { DecisionAction } from "./policy.js";
import type { Usage } from "./usage.js";

/**
 * Metadata-only telemetry (plan E4.2, §1 privacy floor). Records are built
 * exclusively from allowlisted scalars — provider/model/path/status/effort
 * levels/decision text/usage numbers — so content and credentials cannot
 * appear by construction.
 */

export interface TelemetryRecord {
  ts: string;
  provider: string;
  model: string;
  /** Query string stripped — Gemini carries API keys in `?key=`. */
  path: string;
  mode: string;
  action: DecisionAction;
  reason: string;
  status: number;
  requestedEffort?: Effort;
  appliedEffort?: Effort;
  wouldHaveEffort?: Effort;
  sessionFingerprint?: string;
  usage: Usage | null;
  costUsd: number | null;
  unpriced?: boolean;
}

export interface TelemetrySink {
  readonly path: string;
  write(record: TelemetryRecord): void;
}

export function defaultTelemetryDir(): string {
  return join(homedir(), ".effortd");
}

export function createJsonlSink(dir: string = defaultTelemetryDir()): TelemetrySink {
  const filePath = join(dir, "requests.jsonl");
  let ready = false;
  return {
    path: filePath,
    write(record) {
      try {
        if (!ready) {
          mkdirSync(dir, { recursive: true });
          ready = true;
        }
        appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
      } catch (error) {
        // Telemetry must never take the gateway down (fail-open).
        console.error("effortd telemetry write failed:", error);
      }
    },
  };
}
