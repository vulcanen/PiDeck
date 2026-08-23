import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
let httpNetworkingPromise: Promise<void> | undefined;

type PiHttpDispatcher = {
  applyHttpProxySettings(httpProxy: string | undefined): void;
  configureHttpDispatcher(timeoutMs?: number): void;
};

export type SystemProxyResolver = (url: string) => Promise<string>;
export type SystemProxyRoute = { type: "direct" } | { type: "proxy"; url: string };

type PiDispatchHandler = {
  onRequestStart?(controller: unknown, context: unknown): void;
  onRequestUpgrade?(controller: unknown, statusCode: number, headers: unknown, socket: unknown): void;
  onResponseStart?(controller: unknown, statusCode: number, headers: unknown, statusMessage?: string): void;
  onResponseData?(controller: unknown, chunk: Buffer): void;
  onResponseEnd?(controller: unknown, trailers: unknown): void;
  onResponseError?(controller: unknown, error: Error): void;
  onResponseStarted?(): void;
  onBodySent?(chunk: Buffer): void;
  onRequestSent?(): void;
};

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function publicNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/gi, "$1***@");
}

function bypassesSystemProxy(origin: URL): boolean {
  const noProxy = firstNonEmpty(process.env.NO_PROXY, process.env.no_proxy);
  if (!noProxy) return false;
  if (noProxy === "*") return true;
  const hostname = origin.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(origin.port || (origin.protocol === "https:" ? 443 : 80));
  return noProxy.split(/[,\s]+/).some((rawEntry) => {
    if (!rawEntry) return false;
    const entry = rawEntry.replace(/^\*?\./, "").toLowerCase();
    const match = /^\[(.*)\]:(\d+)$/.exec(entry)
      ?? (entry.includes("::") ? null : /^(.*):(\d+)$/.exec(entry));
    const entryHostname = (match?.[1] ?? entry).replace(/^\[|\]$/g, "");
    const entryPort = match ? Number(match[2]) : 0;
    return (!entryPort || entryPort === port)
      && (hostname === entryHostname || hostname.endsWith(`.${entryHostname}`));
  });
}

function proxyUrl(kind: string, address: string): string | undefined {
  const normalizedAddress = address.trim();
  if (!normalizedAddress || /[\r\n\0]/.test(normalizedAddress)) return undefined;
  const scheme = kind === "HTTPS"
    ? "https"
    : kind === "SOCKS" || kind === "SOCKS5"
      ? "socks5"
      : kind === "PROXY" || kind === "HTTP"
        ? "http"
        : undefined;
  if (!scheme) return undefined;
  try {
    return new URL(`${scheme}://${normalizedAddress}`).toString();
  } catch {
    return undefined;
  }
}

/** Parse Chromium proxy rules while preserving their ordered fallback list. */
export function systemProxyRoutesFromElectronRules(rules: string): SystemProxyRoute[] {
  const routes: SystemProxyRoute[] = [];
  for (const rule of rules.split(";")) {
    const trimmed = rule.trim();
    if (!trimmed) continue;
    const [kind = "", ...addressParts] = trimmed.split(/\s+/);
    const normalizedKind = kind.toUpperCase();
    if (normalizedKind === "DIRECT") {
      routes.push({ type: "direct" });
      continue;
    }
    const url = proxyUrl(normalizedKind, addressParts.join(" "));
    if (url) routes.push({ type: "proxy", url });
  }
  return routes;
}

function isProxyConnectionSetupError(error: unknown): boolean {
  const retryableCodes = new Set([
    "ECONNREFUSED",
    "EHOSTDOWN",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
  ]);
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && retryableCodes.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}

function installSystemProxyDispatcher(
  sdkModule: string,
  resolveProxy: SystemProxyResolver,
): void {
  const requireFromPi = createRequire(sdkModule);
  const undici = requireFromPi("undici") as {
    ProxyAgent: new (options: { uri: string }) => { dispatch(options: unknown, handler: unknown): boolean; close(): Promise<void>; destroy(error?: Error): Promise<void> };
    getGlobalDispatcher(): { dispatch(options: unknown, handler: unknown): boolean; close(): Promise<void>; destroy(error?: Error): Promise<void> };
    setGlobalDispatcher(dispatcher: unknown): void;
  };
  const directDispatcher = undici.getGlobalDispatcher();
  const proxyDispatchers = new Map<string, InstanceType<typeof undici.ProxyAgent>>();
  const systemDispatcher = {
    dispatch(options: { origin?: string | URL; path?: string }, handler: PiDispatchHandler): boolean {
      let origin: URL;
      try {
        origin = new URL(String(options.origin));
      } catch {
        handler.onResponseError?.(null, new Error("Pi HTTP request has an invalid origin"));
        return false;
      }
      if (bypassesSystemProxy(origin)) return directDispatcher.dispatch(options, handler);
      const requestUrl = new URL(options.path ?? "/", origin).toString();
      void resolveProxy(requestUrl).then((rules) => {
        const routes = systemProxyRoutesFromElectronRules(rules);
        if (routes.length === 0) throw new Error(`System proxy returned no supported route for ${origin.hostname}`);

        const dispatchRoute = (routeIndex: number): void => {
          const route = routes[routeIndex];
          if (!route) throw new Error(`System proxy exhausted every route for ${origin.hostname}`);
          const dispatcher = route.type === "direct"
            ? directDispatcher
            : proxyDispatchers.get(route.url) ?? (() => {
                const created = new undici.ProxyAgent({ uri: route.url });
                proxyDispatchers.set(route.url, created);
                return created;
              })();
          let requestTransmissionStarted = false;
          const routeHandler: PiDispatchHandler = {
            onRequestStart: (controller, context) => handler.onRequestStart?.(controller, context),
            onRequestUpgrade: (controller, statusCode, headers, socket) => {
              requestTransmissionStarted = true;
              handler.onRequestUpgrade?.(controller, statusCode, headers, socket);
            },
            onResponseStart: (controller, statusCode, headers, statusMessage) => {
              requestTransmissionStarted = true;
              handler.onResponseStart?.(controller, statusCode, headers, statusMessage);
            },
            onResponseData: (controller, chunk) => handler.onResponseData?.(controller, chunk),
            onResponseEnd: (controller, trailers) => handler.onResponseEnd?.(controller, trailers),
            onResponseStarted: () => {
              requestTransmissionStarted = true;
              handler.onResponseStarted?.();
            },
            onBodySent: (chunk) => {
              requestTransmissionStarted = true;
              handler.onBodySent?.(chunk);
            },
            onRequestSent: () => {
              requestTransmissionStarted = true;
              handler.onRequestSent?.();
            },
            onResponseError: (controller, error) => {
              if (!requestTransmissionStarted && isProxyConnectionSetupError(error) && routeIndex + 1 < routes.length) {
                try {
                  dispatchRoute(routeIndex + 1);
                } catch (fallbackError) {
                  const detail = publicNetworkError(fallbackError);
                  handler.onResponseError?.(controller, new Error(`System proxy request failed for ${origin.hostname}: ${detail}`));
                }
                return;
              }
              const detail = publicNetworkError(error);
              handler.onResponseError?.(controller, new Error(`System proxy request failed for ${origin.hostname}: ${detail}`));
            },
          };
          try {
            dispatcher.dispatch(options, routeHandler);
          } catch (error) {
            if (!requestTransmissionStarted && isProxyConnectionSetupError(error) && routeIndex + 1 < routes.length) {
              dispatchRoute(routeIndex + 1);
              return;
            }
            throw error;
          }
        };

        dispatchRoute(0);
      }).catch((error) => {
        const detail = publicNetworkError(error);
        handler.onResponseError?.(null, new Error(`System proxy setup failed for ${origin.hostname}: ${detail}`));
      });
      return true;
    },
    async close(): Promise<void> {
      await Promise.all([directDispatcher.close(), ...Array.from(proxyDispatchers.values(), (dispatcher) => dispatcher.close())]);
    },
    async destroy(error?: Error): Promise<void> {
      await Promise.all([directDispatcher.destroy(error), ...Array.from(proxyDispatchers.values(), (dispatcher) => dispatcher.destroy(error))]);
    },
  };
  undici.setGlobalDispatcher(systemDispatcher);
}

function addPiRoots(candidates: string[], root: string): void {
  const normalized = root.trim().replace(/^['"]|['"]$/g, "");
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
    const match = /([A-Za-z]:[^"\r\n]*@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]index\.js)/i.exec(shim);
    if (match) candidates.push(match[1].replaceAll("\\\\", path.sep));
  } catch {
    // A shell shim is optional; the prefix candidates are sufficient.
  }
}

export function packagedPiNodeModules(adapterDirectory: string = __dirname): string | undefined {
  const normalized = adapterDirectory.replaceAll("\\", "/");
  const marker = "/app.asar/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return undefined;
  // Keep the separator style derived from the inspected path, not from the
  // machine running the check. Forward slashes work with Node on Windows and
  // let release validation inspect macOS paths without corrupting them.
  return `${normalized.slice(0, markerIndex + "/app.asar".length)}/node_modules`;
}

export function isPackagedPiAdapter(adapterDirectory: string = __dirname): boolean {
  return packagedPiNodeModules(adapterDirectory) !== undefined;
}

/** Locate the installed Pi SDK without making Renderer or Main depend on its internals. */
export function resolvePiModule(): string {
  if (process.env.PIDECK_PI_MODULE && existsSync(process.env.PIDECK_PI_MODULE)) return process.env.PIDECK_PI_MODULE;
  const candidates: string[] = [];
  const packagedNodeModules = packagedPiNodeModules();

  // Official installers carry a lockfile-pinned Pi SDK inside app.asar. Never
  // let an unrelated global `pi` command silently replace that SDK: packaged
  // builds use the bundled copy unless PIDECK_PI_MODULE explicitly opts into a
  // compatibility test. Development builds retain global discovery as a
  // convenience for working on Pi and PiDeck together.
  if (packagedNodeModules) {
    addPiRoots(candidates, packagedNodeModules);
    const bundled = candidates.find((candidate) => existsSync(candidate));
    if (bundled) return bundled;
    throw new Error("Could not locate the bundled Pi SDK. Reinstall PiDeck or set PIDECK_PI_MODULE for compatibility testing.");
  }

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

export function piHttpDispatcherModule(piModule: string = resolvePiModule()): string {
  const modulePath = path.join(path.dirname(piModule), "core", "http-dispatcher.js");
  if (!existsSync(modulePath)) {
    throw new Error(
      "The installed Pi SDK does not expose its HTTP dispatcher. Install the PiDeck-supported Pi SDK version or remove PIDECK_PI_MODULE.",
    );
  }
  return modulePath;
}

export function loadPiSdk(): Promise<PiSdk> {
  sdkPromise ??= import(pathToFileURL(resolvePiModule()).href).catch((error) => {
    sdkPromise = undefined;
    throw error;
  }) as Promise<PiSdk>;
  return sdkPromise;
}

/** Configure the same proxy-aware Undici dispatcher used by the Pi CLI. */
export function configurePiHttpNetworking(options: { resolveSystemProxy?: SystemProxyResolver } = {}): Promise<void> {
  httpNetworkingPromise ??= (async () => {
    const sdkModule = resolvePiModule();
    const [sdk, dispatcherModule] = await Promise.all([
      loadPiSdk(),
      import(pathToFileURL(piHttpDispatcherModule(sdkModule)).href) as Promise<Partial<PiHttpDispatcher>>,
    ]);
    if (
      typeof dispatcherModule.applyHttpProxySettings !== "function"
      || typeof dispatcherModule.configureHttpDispatcher !== "function"
    ) {
      throw new Error("The installed Pi SDK has an incompatible HTTP dispatcher API");
    }

    const agentDir = sdk.getAgentDir?.();
    const settingsManager = sdk.SettingsManager?.create(process.cwd(), agentDir);
    const httpProxy = settingsManager?.getGlobalSettings?.().httpProxy as string | undefined;
    const httpIdleTimeoutMs = settingsManager?.getHttpIdleTimeoutMs?.() as number | undefined;
    dispatcherModule.applyHttpProxySettings(httpProxy);
    dispatcherModule.configureHttpDispatcher(httpIdleTimeoutMs);
    const hasConfiguredProxy = Boolean(firstNonEmpty(
      process.env.HTTPS_PROXY,
      process.env.https_proxy,
      process.env.HTTP_PROXY,
      process.env.http_proxy,
    ));
    if (process.env.PIDECK_USE_SYSTEM_PROXY === "1" && !hasConfiguredProxy) {
      if (!options.resolveSystemProxy) throw new Error("PiDeck system proxy resolver is unavailable");
      installSystemProxyDispatcher(sdkModule, options.resolveSystemProxy);
    }
  })().catch((error) => {
    httpNetworkingPromise = undefined;
    throw error;
  });
  return httpNetworkingPromise;
}

export function getModelRuntime(): Promise<any> {
  modelRuntimePromise ??= configurePiHttpNetworking().then(loadPiSdk).then((sdk) => sdk.ModelRuntime.create({ allowModelNetwork: false })).catch((error) => {
    modelRuntimePromise = undefined;
    throw error;
  });
  return modelRuntimePromise;
}

export function modelSummary(provider: any, model: any, authConfigured: boolean) {
  const thinkingLevelMap = model.thinkingLevelMap as Record<string, string | null | undefined> | undefined;
  const supportedThinkingLevels = ["off", "minimal", "low", "medium", "high"]
    .filter((level) => thinkingLevelMap?.[level] !== null);
  // Pi supports the extended levels only when the model explicitly maps
  // them. Keep this in lockstep with getSupportedThinkingLevels().
  if (thinkingLevelMap?.xhigh !== undefined && thinkingLevelMap.xhigh !== null) supportedThinkingLevels.push("xhigh");
  if (thinkingLevelMap?.max !== undefined && thinkingLevelMap.max !== null) supportedThinkingLevels.push("max");
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
  return "No model selected";
}
