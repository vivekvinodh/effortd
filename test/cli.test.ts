import { describe, expect, it } from "vitest";
import { COMMANDS, helpText, parseCli } from "../src/cli.js";

describe("cli parsing (E0.1 smoke)", () => {
  it("recognizes each stub command and passes remaining args through", () => {
    for (const command of COMMANDS) {
      expect(parseCli([command])).toEqual({ command, args: [] });
    }
    expect(parseCli(["start", "--port", "5151"])).toEqual({
      command: "start",
      args: ["--port", "5151"],
    });
  });

  it("treats a bare invocation and -h/--help as help", () => {
    expect(parseCli([])).toEqual({ command: "help", args: [] });
    expect(parseCli(["-h"])).toEqual({ command: "help", args: [] });
    expect(parseCli(["--help"])).toEqual({ command: "help", args: [] });
  });

  it("rejects unknown commands with an error naming the input", () => {
    expect(parseCli(["strat"])).toMatchObject({
      error: expect.stringContaining("strat"),
    });
  });

  it("help text names every command", () => {
    const text = helpText();
    for (const command of COMMANDS) {
      expect(text).toContain(command);
    }
  });
});
