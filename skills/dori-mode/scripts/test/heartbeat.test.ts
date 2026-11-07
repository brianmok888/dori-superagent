import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "../src/run.ts";
import { withState } from "./fakes.ts";

const cli = join(import.meta.dir, "../src/cli.ts");

test("heartbeat one-shot prints exactly one HEARTBEAT line with an ISO timestamp and exits 0", async () => {
  const state = withState();
  try {
    const config = join(state.dir, "config.json");
    writeFileSync(config, JSON.stringify({ stateDir: state.dir, defaultCwd: state.dir, hooks: {} }));
    const r = await run(["env", `DORI_CONFIG=${config}`, `DORI_STATE_DIR=${state.dir}`, process.execPath, cli, "heartbeat"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^HEARTBEAT \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n?$/);
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(r.err).toBe("");
  } finally {
    state.done();
  }
});

test("heartbeat --loop beats first and keeps sleeping, so the process stays alive until killed", async () => {
  const state = withState();
  try {
    const config = join(state.dir, "config.json");
    writeFileSync(config, JSON.stringify({ stateDir: state.dir, defaultCwd: state.dir, hooks: {} }));
    const proc = Bun.spawn(["env", `DORI_CONFIG=${config}`, `DORI_STATE_DIR=${state.dir}`, process.execPath, cli, "heartbeat", "--loop", "60"], { stdout: "pipe" });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    const first = new TextDecoder().decode(value ?? new Uint8Array());
    expect(first).toMatch(/^HEARTBEAT /);
    expect(proc.exitCode).toBeNull(); // beat printed, minute-sleep running: not exited
    proc.kill();
    await proc.exited;
  } finally {
    state.done();
  }
});
