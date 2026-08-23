import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pideck-session-isolation-"));
const agentDir = path.join(tempRoot, "agent");
const projectA = path.join(tempRoot, "project-a");
const projectB = path.join(tempRoot, "project-b");
const sourceProject = path.join(tempRoot, "source-project");
const sourceDir = path.join(tempRoot, "source-sessions");
for (const directory of [agentDir, projectA, projectB, sourceProject, sourceDir]) mkdirSync(directory, { recursive: true });

const piModulePath = path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
process.env.PI_CODING_AGENT_DIR = agentDir;
const sdk = await import(pathToFileURL(piModulePath).href);
const sourceManager = sdk.SessionManager.create(sourceProject, sourceDir);
sourceManager.appendSessionInfo("Isolation smoke source");
sourceManager.appendMessage({ role: "user", content: "isolation smoke", timestamp: Date.now() });
sourceManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: Date.now() });
const sourcePath = sourceManager.getSessionFile();

const child = fork(path.join(root, "packages", "pi-host", "dist", "index.js"), [], {
  cwd: root,
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PIDECK_HOST_PROCESS: "1",
    PIDECK_PI_MODULE: piModulePath,
  },
  stdio: ["ignore", "ignore", "pipe", "ipc"],
  windowsHide: true,
});

const pending = new Map();
let stderr = "";
let requestSequence = 0;
let resolveConnected;
const connected = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("PiHost did not connect")), 15_000);
  resolveConnected = () => {
    clearTimeout(timer);
    resolve();
  };
});
child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
child.on("message", (message) => {
  if (message?.type === "runtime.status" && message.payload === "connected") {
    resolveConnected();
    return;
  }
  const waiter = pending.get(message?.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error ?? "PiHost request failed"));
});

function request(command, payload) {
  const id = `isolation-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${command}`));
    }, 30_000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolve(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
    child.send({ id, command, payload });
  });
}

try {
  await connected;
  const importedA = await request("sessions.import", { inputPath: sourcePath, cwd: projectA });
  const importedB = await request("sessions.import", { inputPath: sourcePath, cwd: projectB });
  if (importedA.id !== importedB.id) throw new Error("Smoke fixture did not preserve the duplicate session ID");

  await request("sessions.delete", { taskId: importedA.id, cwd: projectA });
  const [sessionsA, sessionsB] = await Promise.all([
    request("sessions.list", { cwd: projectA }),
    request("sessions.list", { cwd: projectB }),
  ]);
  if (sessionsA.some((session) => session.id === importedA.id)) throw new Error("Deleted session still exists in project A");
  if (!sessionsB.some((session) => session.id === importedB.id)) throw new Error("Deleting project A removed the same-ID session from project B");
  process.stdout.write("Cross-project session isolation smoke passed\n");
} catch (error) {
  if (stderr.trim()) process.stderr.write(`${stderr.trim()}\n`);
  throw error;
} finally {
  child.kill();
  rmSync(tempRoot, { recursive: true, force: true });
}
