#!/usr/bin/env node
import { helpText, parseCli } from "./cli.js";

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
  case "start":
  case "init":
  case "report":
    console.error(
      `effortd ${parsed.command}: not implemented yet — this build is the E0.1 scaffold (see docs/V1-READINESS-PLAN.md).`,
    );
    process.exit(1);
}
