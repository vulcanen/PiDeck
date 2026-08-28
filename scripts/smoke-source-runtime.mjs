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
      child.send({ id: "projects-list", command: "projects.list", payload: { knownCwds: [root] } });
      return;
    }
    if (message?.id === "projects-list") {
      if (!message.ok || !Array.isArray(message.result)) {
        finish(new Error(`Unexpected projects.list response: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "models-list", command: "models.list" });
      return;
    }
    if (message?.id === "models-list") {
      if (!message.ok || !Array.isArray(message.result)) {
        finish(new Error(`Unexpected models.list response: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "providers-list", command: "providers.list" });
      return;
    }
    if (message?.id === "providers-list") {
      if (!message.ok || !Array.isArray(message.result)) {
        finish(new Error(`Unexpected providers.list response: ${JSON.stringify(message)}`));
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
      child.send({ id: "session-run-metadata", command: "sessions.runMetadata", payload: { taskId, cwd: root } });
      return;
    }
    if (message?.id === "session-run-metadata") {
      if (!message.ok || !Array.isArray(message.result)) {
        finish(new Error(`Unexpected sessions.runMetadata response: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "session-change-reviews", command: "sessions.changeReviews", payload: { taskId, cwd: root } });
      return;
    }
    if (message?.id === "session-change-reviews") {
      if (!message.ok || !Array.isArray(message.result)) {
        finish(new Error(`Unexpected sessions.changeReviews response: ${JSON.stringify(message)}`));
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
      child.send({ id: "agent-queue", command: "agent.queue", payload: { taskId, cwd: root } });
      return;
    }
    if (message?.id === "agent-queue") {
      if (!message.ok || !Array.isArray(message.result?.steering) || !Array.isArray(message.result?.followUp)) {
        finish(new Error(`Unexpected agent.queue response: ${JSON.stringify(message)}`));
        return;
      }
      // A successful arbitrary deletion requires a live queued prompt and would
      // trigger Provider side effects. Exercise the command safely with a stale
      // stable ID and require the actionable validation error instead.
      child.send({ id: "agent-delete-queue", command: "agent.deleteQueue", payload: { taskId, cwd: root, messageId: "missing-smoke-queue-entry" } });
      return;
    }
    if (message?.id === "agent-delete-queue") {
      if (message.ok || !String(message.error ?? "").includes("Queued message is no longer available")) {
        finish(new Error(`Unexpected agent.deleteQueue response: ${JSON.stringify(message)}`));
        return;
      }
      child.send({ id: "workspace-snapshot", command: "workspace.snapshot", payload: { cwd: root } });
      return;
    }
    if (message?.id === "workspace-snapshot") {
      if (!message.ok || !message.result || !Array.isArray(message.result.files)) {
        finish(new Error(`Unexpected workspace.snapshot response: ${JSON.stringify(message)}`));
        return;
      }
      finish();
    }
  });
});

process.stdout.write(`PiHost IPC smoke passed with Pi SDK ${expectedPiVersion} and pi-permission-system ${expectedPermissionVersion}.\n`);
