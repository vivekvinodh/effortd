export const COMMANDS = ["start", "init", "report", "help"] as const;

export type Command = (typeof COMMANDS)[number];

export interface CliInvocation {
  command: Command;
  args: string[];
}

export interface CliError {
  error: string;
}

export function parseCli(argv: string[]): CliInvocation | CliError {
  const [first, ...rest] = argv;
  if (first === undefined || first === "-h" || first === "--help") {
    return { command: "help", args: [] };
  }
  if ((COMMANDS as readonly string[]).includes(first)) {
    return { command: first as Command, args: rest };
  }
  return { error: `unknown command: ${first}` };
}

export function helpText(): string {
  return [
    "effortd — reasoning-spend policy gateway for AI coding agents",
    "",
    "Usage: effortd <command> [options]",
    "",
    "Commands:",
    "  start    Run the gateway (point your agent's provider base URL at it)",
    "  init     Write a commented effortd.yaml config example",
    "  report   Summarize recorded effort/token/cost telemetry",
    "  help     Show this help",
    "",
    "Status: pre-release scaffold — commands land per docs/V1-READINESS-PLAN.md.",
  ].join("\n");
}
