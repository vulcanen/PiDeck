import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The supported Pi SDK surface used by PiDeck's host adapter. */
export type PiSdk = {
  ModelRuntime: {
    create(options?: { allowModelNetwork?: boolean }): Promise<any>;
  };
  DefaultResourceLoader?: new (options: { cwd: string; agentDir: string; additionalExtensionPaths?: string[] }) => any;
  DefaultPackageManager?: new (options: { cwd: string; agentDir: string; settingsManager: any }) => any;
  SettingsManager?: { create(cwd: string, agentDir?: string): any };
  ProjectTrustStore?: new (agentDir: string) => any;
  getAgentDir?: () => string;
  parseSkillBlock?: (text: string) => { name: string; location: string; content: string; userMessage?: string } | null;
  SessionManager: {
    list(cwd: string): Promise<any[]>;
    listAll(): Promise<any[]>;
    create(cwd: string): {
      appendSessionInfo(name: string): void;
      getSessionId(): string;
      getSessionDir?: () => string;
      getSessionFile?: () => string | undefined;
    };
    open(path: string, sessionDir?: string, cwdOverride?: string): any;
    inMemory(cwd?: string): any;
  };
  createAgentSession(options: { cwd: string; sessionManager: any; modelRuntime: any; resourceLoader?: any }): Promise<{ session: any }>;
};

let sdkPromise: Promise<PiSdk> | undefined;
let modelRuntimePromise: Promise<any> | undefined;

function addPiRoots(candidates: string[], root: string): void {
  const normalized = root.trim().replace(/^['\"]|['\"]$/g, "");
  if (!normalized) return;
  candidates.push(path.join(normalized, "@earendil-works", "pi-coding-agent", "dist", "index.js"));
  candidates.push(path.join(normalized, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"));
}

function addPiExecutable(candidates: string[], executable: string): void {
  const clean = executable.trim();
  if (!clean) return;
  addPiRoots(candidates, path.dirname(clean));
  if (process.platform === "win32" && existsSync(`${clean}.cmd`)) addPiRoots(candidates, path.dirname(`${clean}.cmd`));
  try {
    const shim = readFileSync(existsSync(clean) ? clean : `${clean}.cmd`, "utf8");
    const match = /([A-Za-z]:[^\"\r\n]*@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]index\.js)/i.exec(shim);
    if (match) candidates.push(match[1].replaceAll("\\\\", path.sep));
  } catch {
    // A shell shim is optional; the prefix candidates are sufficient.
  }
}

/** Locate the installed Pi SDK without making Renderer or Main depend on its internals. */
export function resolvePiModule(): string {
  if (process.env.PIDECK_PI_MODULE && existsSync(process.env.PIDECK_PI_MODULE)) return process.env.PIDECK_PI_MODULE;
  const candidates: string[] = [];
  try {
    const executable = process.platform === "win32"
      ? execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"), ["pi"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean) ?? ""
      : execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    addPiExecutable(candidates, executable);
  } catch {
    // Continue with PATH and npm-prefix discovery.
  }
  for (const bin of (process.env.PATH ?? "").split(path.delimiter)) if (bin) addPiRoots(candidates, path.join(bin, "node_modules"));
  for (const prefix of [process.env.PIDECK_PI_GLOBAL_ROOT, process.env.npm_config_prefix, process.env.NPM_CONFIG_PREFIX, process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "", process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm") : ""]) if (prefix) addPiRoots(candidates, prefix);
  for (const npmCommand of process.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"]) {
    try { addPiRoots(candidates, execFileSync(npmCommand, ["root", "-g"], { encoding: "utf8" })); } catch { /* npm is optional in packaged builds */ }
  }
  addPiRoots(candidates, path.resolve(process.cwd(), "node_modules"));
  addPiRoots(candidates, path.resolve(__dirname, "../../../node_modules"));
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Could not locate Pi SDK. Set PIDECK_PI_MODULE to @earendil-works/pi-coding-agent/dist/index.js. Searched ${candidates.length} locations.`);
  }
  return resolved;
}

export function loadPiSdk(): Promise<PiSdk> {
  sdkPromise ??= import(pathToFileURL(resolvePiModule()).href).catch((error) => {
    sdkPromise = undefined;
    throw error;
  }) as Promise<PiSdk>;
  return sdkPromise;
}

export function getModelRuntime(): Promise<any> {
  modelRuntimePromise ??= loadPiSdk().then((sdk) => sdk.ModelRuntime.create({ allowModelNetwork: false })).catch((error) => {
    modelRuntimePromise = undefined;
    throw error;
  });
  return modelRuntimePromise;
}

export function modelSummary(provider: any, model: any, authConfigured: boolean) {
  const thinkingLevelMap = model.thinkingLevelMap as Record<string, string | null | undefined> | undefined;
  const supportedThinkingLevels = ["off", "minimal", "low", "medium", "high"];
  // Pi supports the extended levels only when the model explicitly maps
  // them. Keep this in lockstep with getSupportedThinkingLevels().
  if (thinkingLevelMap?.xhigh !== undefined) supportedThinkingLevels.push("xhigh");
  if (thinkingLevelMap?.max !== undefined) supportedThinkingLevels.push("max");
  return {
    id: model.id,
    providerId: provider.id,
    providerName: provider.name ?? provider.id,
    name: model.name ?? model.id,
    reasoning: Boolean(model.reasoning),
    thinkingLevels: model.reasoning
      ? supportedThinkingLevels
      : ["off"],
    authConfigured,
  };
}

export function sessionModelLabel(sessionInfo: any, sdk: PiSdk): string {
  try {
    const manager = sdk.SessionManager.open(sessionInfo.path);
    const model = manager.buildSessionContext?.().model;
    if (model?.provider && (model?.modelId || model?.id)) return `${model.provider}/${model.modelId ?? model.id}`;
  } catch {
    // Older or partially written session files may not have a model entry.
  }
  return "未选择模型";
}
