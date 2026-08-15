import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const expectedPiVersion = packageJson.dependencies["@earendil-works/pi-coding-agent"];
const expectedPermissionVersion = JSON.parse(readFileSync(path.join(root, "node_modules", "@gotgenes", "pi-permission-system", "package.json"), "utf8")).version;
const hostPath = path.join(root, "packages", "pi-host", "dist", "index.js");
const piModulePath = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
const agentDir = mkdtempSync(path.join(os.tmpdir(), "pideck-source-smoke-"));

await new Promise((resolve, reject) => {
  let stderr = "";
  let requested = false;
  let settled = false;
  let taskId;
  const child = fork(hostPath, [], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PIDECK_HOST_PROCESS: "1", PIDECK_PI_MODULE: piModulePath },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const finish = (error) => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timer);
    child.kill();
    rmSync(agentDir, { recursive: true, force: true });
    if (error) reject(new Error(`${error.message}${stderr ? `\n${stderr.trim()}` : ""}`));
    else resolve();
  };
  const timer = globalThis.setTimeout(() => finish(new Error("Source PiHost IPC smoke timed out")), 30_000);
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", (error) => finish(error));
  child.on("exit", (code, signal) => {
    if (!settled) finish(new Error(`Source PiHost exited before completing smoke (code ${code ?? "null"}, signal ${signal ?? "none"})`));
  });
  child.on("message", (message) => {
    if (message?.type === "runtime.status" && message.payload === "connected" && !requested) {
      requested = true;
      child.send({ id: "runtime-status", command: "runtime.status" });
      return;
    }
    if (message?.id === "runtime-status") {
      if (!message.ok || message.result !== "connected") {
        finish(new Error(`Unexpected runtime.status response: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "app-info", command: "app.info" });
      return;
    }
    if (message?.id === "app-info") {
      if (!message.ok || message.result?.version !== expectedPiVersion) {
        finish(new Error(`Source Pi SDK mismatch: expected ${expectedPiVersion}, received ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "permission-status", command: "permissions.status" });
      return;
    }
    if (message?.id === "permission-status") {
      if (!message.ok || message.result?.source !== "pi-permission-system" || !String(message.result?.configPath ?? "").startsWith(agentDir)) {
        finish(new Error(`Unexpected permission status: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "session-create", command: "sessions.create", payload: { cwd: root, name: "Permission extension smoke" } });
      return;
    }
    if (message?.id === "session-create") {
      taskId = message.ok ? message.result?.id : undefined;
      if (!taskId) {
        finish(new Error(`Could not create smoke session: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "session-capabilities", command: "sessions.capabilities", payload: { taskId, cwd: root } });
      return;
    }
    if (message?.id === "session-capabilities") {
      const commands = Array.isArray(message.result?.slashCommands) ? message.result.slashCommands : [];
      if (!message.ok || !commands.some((command) => command?.name === "permission-system")) {
        finish(new Error(`Permission Extension did not load: ${JSON.stringify(message)}`));
        return;
      }
      finish();
    }
  });
});

process.stdout.write(`PiHost IPC smoke passed with Pi SDK ${expectedPiVersion} and pi-permission-system ${expectedPermissionVersion}.\n`);
