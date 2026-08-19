#!/usr/bin/env node
import { helpText, parseCli } from "./cli.js";
import { createGateway } from "./server.js";

const DEFAULT_PORT = 4141;

/** Loopback-only by design; exposure beyond localhost is a deliberate non-feature for now. */
const DEFAULT_MOUNTS: Record<string, string> = {
  "/anthropic": "https://api.anthropic.com",
  "/openai": "https://api.openai.com",
  "/gemini": "https://generativelanguage.googleapis.com",
};

const parsed = parseCli(process.argv.slice(2));

if ("error" in parsed) {
  console.error(`effortd: ${parsed.error}\n`);
  console.error(helpText());
  process.exit(2);
}

switch (parsed.command) {
  case "help":
    console.log(helpText());
    break;
  case "start": {
    const portFlag = parsed.args.indexOf("--port");
    const port =
      portFlag >= 0 ? Number(parsed.args[portFlag + 1]) : DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`effortd start: invalid --port value`);
      process.exit(2);
    }
    const server = createGateway({
      mounts: DEFAULT_MOUNTS,
      hooks: {
        tapResponse: (request, response) => {
          console.log(
            `[effortd] ${request.method} ${request.mount}${request.path} -> ${response.status}`,
          );
          return undefined;
        },
      },
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`effortd listening on http://127.0.0.1:${port}`);
      for (const [mount, upstream] of Object.entries(DEFAULT_MOUNTS)) {
        console.log(`  ${mount} -> ${upstream}`);
      }
    });
    break;
  }
  case "init":
  case "report":
    console.error(
      `effortd ${parsed.command}: not implemented yet — lands per docs/V1-READINESS-PLAN.md.`,
    );
    process.exit(1);
}
