#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { helpText, parseCli } from "./cli.js";
import { ConfigError, exampleConfig, loadConfig } from "./config.js";
import { createEffortdHooks } from "./pipeline.js";
import { createJsonlSink } from "./telemetry.js";
import { anthropic } from "./providers/anthropic.js";
import { gemini } from "./providers/gemini.js";
import { openai } from "./providers/openai.js";
import { createGateway } from "./server.js";
import { SessionStore } from "./session.js";

const parsed = parseCli(process.argv.slice(2));

if ("error" in parsed) {
  console.error(`effortd: ${parsed.error}\n`);
  console.error(helpText());
  process.exit(2);
}

/** Loopback-only by design; exposure beyond localhost is a deliberate non-feature for now. */
const MOUNTS: Record<string, string> = {
  "/anthropic": anthropic.upstream,
  "/openai": openai.upstream,
  "/gemini": gemini.upstream,
};

const MOUNT_ADAPTERS = {
  "/anthropic": "anthropic",
  "/openai": "openai",
  "/gemini": "gemini",
} as const;

switch (parsed.command) {
  case "help":
    console.log(helpText());
    break;

  case "start": {
    let loaded;
    try {
      loaded = loadConfig();
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`effortd: invalid config — ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
    const { config, warnings, source } = loaded;
    for (const warning of warnings) {
      console.warn(`[effortd] config warning: ${warning}`);
    }

    const portFlag = parsed.args.indexOf("--port");
    const port =
      portFlag >= 0 ? Number(parsed.args[portFlag + 1]) : config.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`effortd start: invalid --port value`);
      process.exit(2);
    }

    const sink = createJsonlSink();
    const hooks = createEffortdHooks({
      config,
      store: new SessionStore(),
      mountAdapters: MOUNT_ADAPTERS,
      sink,
      onAccess: (line) => console.log(`[effortd] ${line}`),
      onDecision: (record) => {
        const { decision } = record;
        if (decision.action === "untouched" && decision.wouldHave === undefined) {
          return;
        }
        const outcome =
          decision.applied !== undefined
            ? ` -> ${decision.applied}`
            : decision.wouldHave !== undefined
              ? ` (would: ${decision.wouldHave})`
              : "";
        console.log(
          `[effortd] policy ${record.provider}/${record.model} ${decision.action}${outcome}: ${decision.reason}`,
        );
      },
    });

    const server = createGateway({ mounts: MOUNTS, hooks });
    server.listen(port, "127.0.0.1", () => {
      console.log(
        `effortd listening on http://127.0.0.1:${port} — mode: ${config.mode} (config: ${source})`,
      );
      for (const [mount, upstream] of Object.entries(MOUNTS)) {
        console.log(`  ${mount} -> ${upstream}`);
      }
    });
    break;
  }

  case "init": {
    const target = "effortd.yaml";
    if (existsSync(target) && !parsed.args.includes("--force")) {
      console.error(
        `effortd init: ${target} already exists — pass --force to overwrite`,
      );
      process.exit(1);
    }
    writeFileSync(target, exampleConfig(), "utf8");
    console.log(`effortd init: wrote ${target} (mode: observe — the safe default)`);
    break;
  }

  case "report":
    console.error(
      `effortd report: not implemented yet — lands per docs/V1-READINESS-PLAN.md (E4.3).`,
    );
    process.exit(1);
}
