const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { assertKnownProjectCwd, assertTrustedIpcSender } = require("../dist/main/ipc-security.js");
const { windowThemeColors } = require("../dist/main/window-theme.js");
const { loadQueueForCurrentTask } = require("../dist/renderer/queue-load.js");
const { isPackagedPiAdapter, modelSummary, packagedPiNodeModules, systemProxyRoutesFromElectronRules } = require("../../../packages/pi-adapter/dist/index.js");
const { copyElectronRuntimeLicenses } = require("../../../scripts/copy-electron-runtime-licenses.cjs");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

function cssThemeTokens(css, selector) {
  const selectorStart = css.indexOf(`${selector} {`);
  assert.notEqual(selectorStart, -1, `missing CSS theme block: ${selector}`);
  const blockStart = css.indexOf("{", selectorStart);
  const blockEnd = css.indexOf("}", blockStart);
  return Object.fromEntries([...css.slice(blockStart + 1, blockEnd).matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]));
}

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    return channels.map((channel) => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + .05) / (values[1] + .05);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("system proxy rules preserve per-URL HTTP, SOCKS, and direct fallback order", () => {
  assert.deepEqual(systemProxyRoutesFromElectronRules("PROXY 127.0.0.1:7897; SOCKS5 localhost:1080; DIRECT"), [
    { type: "proxy", url: "http://127.0.0.1:7897/" },
    { type: "proxy", url: "socks5://localhost:1080" },
    { type: "direct" },
  ]);
  assert.deepEqual(systemProxyRoutesFromElectronRules("DIRECT"), [{ type: "direct" }]);
});

test("Pi HTTP networking gives Pi settings priority over the system-proxy fallback", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-proxy-settings-"));
  const root = path.join(__dirname, "../../..");
  const adapterPath = path.join(root, "packages/pi-adapter/dist/index.js");
  const piModule = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  const script = `
    const { configurePiHttpNetworking } = require(${JSON.stringify(adapterPath)});
    configurePiHttpNetworking({ resolveSystemProxy: async () => { throw new Error("system resolver must not run"); } }).then(() => process.stdout.write(JSON.stringify({
      http: process.env.HTTP_PROXY ?? null,
      https: process.env.HTTPS_PROXY ?? null,
      noProxy: process.env.NO_PROXY ?? null,
    })));
  `;
  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PIDECK_PI_MODULE: piModule,
    PIDECK_USE_SYSTEM_PROXY: "1",
  };
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"]) delete environment[key];

  try {
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ httpProxy: "http://pi.proxy:9000" }));
    const output = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env: environment });
    assert.deepEqual(JSON.parse(output), {
      http: "http://pi.proxy:9000",
      https: "http://pi.proxy:9000",
      noProxy: null,
    });

  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("Pi HTTP networking resolves each request URL and fails over before transmission", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-dynamic-proxy-"));
  const root = path.join(__dirname, "../../..");
  const adapterPath = path.join(root, "packages/pi-adapter/dist/index.js");
  const piModule = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  fs.writeFileSync(path.join(agentDir, "settings.json"), "{}");
  const script = `
    const http = require("node:http");
    const { configurePiHttpNetworking } = require(${JSON.stringify(adapterPath)});
    (async () => {
      const origins = [];
      let proxyHits = 0;
      const proxy = http.createServer((request, response) => {
        proxyHits += 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ path: request.url, method: request.method }));
      });
      const unavailableProxy = http.createServer();
      const direct = http.createServer((_request, response) => response.end("direct"));
      await new Promise((resolve) => unavailableProxy.listen(0, "127.0.0.1", resolve));
      const unavailableAddress = unavailableProxy.address();
      await new Promise((resolve) => unavailableProxy.close(resolve));
      await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      await new Promise((resolve) => direct.listen(0, "127.0.0.1", resolve));
      const address = proxy.address();
      const directAddress = direct.address();
      await configurePiHttpNetworking({
        resolveSystemProxy: async (origin) => {
          origins.push(origin);
          return "PROXY 127.0.0.1:" + unavailableAddress.port + "; PROXY 127.0.0.1:" + address.port + "; DIRECT";
        },
      });
      const response = await fetch("http://pideck-proxy-target.invalid/token", { method: "POST", body: "code=test" });
      const result = await response.json();
      process.env.NO_PROXY = "127.0.0.1";
      const directResult = await fetch("http://127.0.0.1:" + directAddress.port + "/health").then((value) => value.text());
      await new Promise((resolve) => proxy.close(resolve));
      await new Promise((resolve) => direct.close(resolve));
      process.stdout.write(JSON.stringify({ origins, path: result.path, method: result.method, proxyHits, directResult }));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const environment = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PIDECK_PI_MODULE: piModule,
    PIDECK_USE_SYSTEM_PROXY: "1",
  };
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"]) delete environment[key];
  try {
    const output = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env: environment });
    assert.deepEqual(JSON.parse(output), {
      origins: ["http://pideck-proxy-target.invalid/token"],
      path: "http://pideck-proxy-target.invalid/token",
      method: "POST",
      proxyHits: 1,
      directResult: "direct",
    });
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a stale queue request cannot overwrite the newly selected task", async () => {
  const first = deferred();
  const second = deferred();
  const committed = [];
  let firstIsCurrent = true;

  const firstLoad = loadQueueForCurrentTask({
    load: () => first.promise,
    isCurrent: () => firstIsCurrent,
    onLoaded: (queue) => committed.push(queue.taskId),
    onError: (error) => { throw error; },
  });
  firstIsCurrent = false;
  const secondLoad = loadQueueForCurrentTask({
    load: () => second.promise,
    isCurrent: () => true,
    onLoaded: (queue) => committed.push(queue.taskId),
    onError: (error) => { throw error; },
  });

  second.resolve({ taskId: "task-b" });
  await secondLoad;
  first.resolve({ taskId: "task-a" });
  await firstLoad;

  assert.deepEqual(committed, ["task-b"]);
});

test("stale queue failures are ignored after task selection changes", async () => {
  const request = deferred();
  const errors = [];
  let current = true;
  const load = loadQueueForCurrentTask({
    load: () => request.promise,
    isCurrent: () => current,
    onLoaded: () => assert.fail("stale request must not commit"),
    onError: (error) => errors.push(error),
  });
  current = false;
  request.reject(new Error("old task failed"));
  await load;
  assert.deepEqual(errors, []);
});

test("IPC accepts only the active window main frame", () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents };

  assert.doesNotThrow(() => assertTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window));
  assert.throws(
    () => assertTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, window),
    /untrusted renderer/,
  );
  assert.throws(
    () => assertTrustedIpcSender({ sender: webContents, senderFrame: {} }, window),
    /untrusted renderer/,
  );
  assert.throws(
    () => assertTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, { ...window, isDestroyed: () => true }),
    /untrusted renderer/,
  );
});

test("PiHost networking startup failures reach the Renderer as sanitized runtime errors", () => {
  const contracts = fs.readFileSync(path.join(__dirname, "../../../packages/contracts/src/index.ts"), "utf8");
  const host = fs.readFileSync(path.join(__dirname, "../../../packages/pi-host/src/index.ts"), "utf8");
  const runtimeEvents = fs.readFileSync(path.join(__dirname, "../src/renderer/use-runtime-events.ts"), "utf8");
  assert.match(contracts, /"runtime\.error"/);
  assert.match(host, /publicRuntimeError\(error\)/);
  assert.match(host, /type: "runtime\.error"/);
  assert.match(runtimeEvents, /runtimeEvent\.type === "runtime\.error"/);
  assert.match(runtimeEvents, /runtimeStartFailed/);
});

test("Electron renderer enforces CSP and rejects in-window navigation", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../src/main/index.ts"), "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /img-src 'self' data: blob:/);
  assert.doesNotMatch(html, /img-src[^;]*https:/);
  assert.doesNotMatch(html, /connect-src[^;]*wss?:/);
  assert.match(main, /webContents\.on\("will-navigate", \(event\) => event\.preventDefault\(\)\)/);
});

test("PiHost lifecycle ignores events from a replaced process and waits for real IPC readiness", () => {
  const main = readText(path.join(__dirname, "../src/main/index.ts"));
  assert.match(main, /if \(host !== startedHost\) return;/);
  assert.match(main, /teardownHost\("PiHost exited", startedHost\)/);
  assert.match(main, /await requestHost\("runtime\.status"\)/);
  assert.doesNotMatch(main, /setTimeout\(resolve, 50\)/);
});

test("PiHost scopes same-ID session resources to their project", () => {
  const host = readText(path.join(__dirname, "../../../packages/pi-host/src/index.ts"));
  assert.match(host, /function sessionStateKey\(taskId: string, cwd: string\)/);
  assert.match(host, /const stateKey = sessionStateKey\(payload\.taskId, cwd\);[\s\S]*?sessionFiles\.delete\(stateKey\)/);
  assert.match(host, /permissionEngine\.dispose\(stateKey\)/);
});

test("inactive conversation panes suspend observers and modal overlays isolate the shell", () => {
  const conversation = readText(path.join(__dirname, "../src/renderer/app-conversation.tsx"));
  const view = readText(path.join(__dirname, "../src/renderer/app-view.tsx"));
  const overlays = readText(path.join(__dirname, "../src/renderer/app-overlays.tsx"));
  const styles = readText(path.join(__dirname, "../src/renderer/styles.css"));
  assert.match(conversation, /if \(!active\) return;[\s\S]*?\}, \[active\]\);/);
  assert.match(view, /inert=\{modalOverlayOpen\}/);
  assert.match(view, /aria-hidden=\{modalOverlayOpen \|\| undefined\}/);
  assert.match(view, /backgroundInert=\{mobileSidebarOpen\}/);
  assert.match(overlays, /className=\{`overlay-root \$\{theme\}\$\{isMac \? " platform-macos" : " platform-overlay"\}`\}/);
  assert.match(styles, /\.app-shell, \.overlay-root \{[\s\S]*?--layer-modal: 40;/);
  assert.match(styles, /\.overlay-root \{\s*color: var\(--text\);\s*\}/);
  assert.match(styles, /\.app-shell\.dark, \.overlay-root\.dark \{/);
  assert.match(styles, /\.overlay-root\.platform-overlay \.settings-backdrop \{[\s\S]*?top: var\(--titlebar-height\);/);
  assert.match(styles, /\.titlebar \{[\s\S]*?background: var\(--canvas\);/);
});

test("light and dark semantic text colors remain readable on primary surfaces", () => {
  const styles = readText(path.join(__dirname, "../src/renderer/styles.css"));
  const themes = [
    ["light", cssThemeTokens(styles, ".app-shell, .overlay-root")],
    ["dark", cssThemeTokens(styles, ".app-shell.dark, .overlay-root.dark")],
  ];
  const pairs = [
    ["--text", "--canvas"], ["--text", "--surface"],
    ["--muted", "--canvas"], ["--muted", "--surface"],
    ["--faint", "--canvas"], ["--faint", "--surface"],
    ["--green", "--surface"], ["--amber", "--surface"], ["--red", "--surface"],
    ["--accent-foreground", "--accent"],
  ];
  for (const [themeName, tokens] of themes) {
    for (const [foreground, background] of pairs) {
      assert.ok(tokens[foreground] && tokens[background], `${themeName} is missing ${foreground} or ${background}`);
      const ratio = contrastRatio(tokens[foreground], tokens[background]);
      assert.ok(ratio >= 4.5, `${themeName} ${foreground} on ${background} contrast ${ratio.toFixed(2)} is below 4.5:1`);
    }
  }
});

test("packaged Pi adapter paths are detected on macOS and Windows", () => {
  const macPath = "/Applications/PiDeck.app/Contents/Resources/app.asar/node_modules/@pideck/pi-adapter/dist";
  const windowsPath = "C:\\Program Files\\PiDeck\\resources\\app.asar\\node_modules\\@pideck\\pi-adapter\\dist";
  assert.equal(isPackagedPiAdapter(macPath), true);
  assert.equal(isPackagedPiAdapter(windowsPath), true);
  assert.equal(packagedPiNodeModules(macPath), "/Applications/PiDeck.app/Contents/Resources/app.asar/node_modules");
  assert.equal(packagedPiNodeModules(windowsPath)?.replaceAll("\\", "/"), "C:/Program Files/PiDeck/resources/app.asar/node_modules");
  assert.equal(isPackagedPiAdapter(path.join(__dirname, "../../../packages/pi-adapter/dist")), false);
});

test("Pi permission Extension is locked consistently across workspaces", () => {
  const root = path.join(__dirname, "../../..");
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@gotgenes/pi-permission-system/package.json"), "utf8"));

  assert.equal(rootPackage.dependencies["@gotgenes/pi-permission-system"], "^25.2.2");
  assert.equal(desktopPackage.dependencies["@gotgenes/pi-permission-system"], "^25.2.2");
  assert.equal(lock.packages["node_modules/@gotgenes/pi-permission-system"].version, "25.2.2");
  assert.equal(installed.version, "25.2.2");
  assert.equal(installed.exports["."].default, "./src/service.ts");
});

test("project-scoped IPC rejects unknown and prefix-confusable directories", () => {
  const known = ["D:\\work\\PiDeck"];
  assert.equal(
    assertKnownProjectCwd("d:\\WORK\\pideck", known, "win32"),
    path.resolve(known[0]),
  );
  assert.throws(
    () => assertKnownProjectCwd("D:\\work\\PiDeck-secret", known, "win32"),
    /not an open PiDeck project/,
  );
  assert.throws(
    () => assertKnownProjectCwd("D:\\work\\PiDeck\\..\\secret", known, "win32"),
    /not an open PiDeck project/,
  );
});

test("package manifest validation rejects developer state and source trees", async () => {
  const verifierUrl = pathToFileURL(path.join(__dirname, "../../../scripts/verify-package-contents.mjs")).href;
  const { validatePackagePaths } = await import(verifierUrl);
  const runtimePaths = [
    "/apps/desktop/dist/main/index.js",
    "/apps/desktop/dist/preload/index.js",
    "/packages/pi-host/dist/index.js",
    "/dist-renderer/index.html",
    "/LICENSE",
    "/THIRD_PARTY_NOTICES.txt",
    "/node_modules/react/index.js",
  ];

  assert.deepEqual(validatePackagePaths(runtimePaths), { fileCount: 7, requiredCount: 6 });
  assert.throws(() => validatePackagePaths([...runtimePaths, "/.codex/session.json"]), /Forbidden development files/);
  assert.throws(() => validatePackagePaths([...runtimePaths, "/apps/desktop/src/main/index.ts"]), /Forbidden development files/);
  assert.throws(() => validatePackagePaths([...runtimePaths, "/node_modules/@pideck/pi-adapter/src/index.ts"]), /Forbidden development files/);
  assert.throws(() => validatePackagePaths([...runtimePaths, "/node_modules/@rolldown/binding-darwin-arm64/package.json"]), /Forbidden development files/);
});

test("packaged SBOM reports the lockfile-pinned Electron runtime as a framework", async () => {
  const generatorUrl = pathToFileURL(path.join(__dirname, "../../../scripts/generate-packaged-sbom.mjs")).href;
  const { electronRuntimeComponent } = await import(generatorUrl);
  const root = path.join(__dirname, "../../..");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const component = electronRuntimeComponent(root);

  assert.equal(component.type, "framework");
  assert.equal(component.name, "electron");
  assert.equal(component.version, lock.packages["node_modules/electron"].version);
  assert.equal(component.purl, `pkg:npm/electron@${component.version}`);
});

test("native window colors follow the Renderer theme contract", () => {
  assert.deepEqual(windowThemeColors("dark"), { background: "#1f1e1b", symbol: "#f3f0e8" });
  assert.deepEqual(windowThemeColors("light"), { background: "#f7f6f1", symbol: "#27251f" });
});

test("each platform package target inherits the runtime whitelist", () => {
  const config = require("../../../electron-builder.config.cjs");
  assert.equal(config.afterExtract, copyElectronRuntimeLicenses);
  for (const target of [config.win.files, config.mac.files]) {
    assert.ok(target.includes("apps/desktop/dist/**/*"));
    assert.ok(target.includes("packages/pi-host/dist/**/*"));
    assert.ok(target.includes("LICENSE"));
    assert.ok(target.includes("THIRD_PARTY_NOTICES.txt"));
    assert.ok(target.includes("!apps/desktop/src/**/*"));
    assert.equal(target.includes("node_modules/**/*"), false);
  }
});

test("Electron runtime licenses are copied from the extracted distribution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-electron-licenses-"));
  try {
    const macOutDir = path.join(root, "mac");
    fs.mkdirSync(path.join(macOutDir, "Electron.app", "Contents", "Resources"), { recursive: true });
    fs.writeFileSync(path.join(macOutDir, "LICENSE"), "electron-mac-license");
    fs.writeFileSync(path.join(macOutDir, "LICENSES.chromium.html"), "chromium-mac-licenses");
    await copyElectronRuntimeLicenses({
      appOutDir: macOutDir,
      electronPlatformName: "darwin",
      packager: { info: { framework: { distMacOsAppName: "Electron.app" } } },
    });
    assert.equal(
      fs.readFileSync(path.join(macOutDir, "Electron.app", "Contents", "Resources", "LICENSE.electron.txt"), "utf8"),
      "electron-mac-license",
    );
    assert.equal(
      fs.readFileSync(path.join(macOutDir, "Electron.app", "Contents", "Resources", "LICENSES.chromium.html"), "utf8"),
      "chromium-mac-licenses",
    );

    const winOutDir = path.join(root, "win");
    fs.mkdirSync(path.join(winOutDir, "resources"), { recursive: true });
    fs.writeFileSync(path.join(winOutDir, "LICENSE.electron.txt"), "electron-win-license");
    fs.writeFileSync(path.join(winOutDir, "LICENSES.chromium.html"), "chromium-win-licenses");
    await copyElectronRuntimeLicenses({ appOutDir: winOutDir, electronPlatformName: "win32" });
    assert.equal(
      fs.readFileSync(path.join(winOutDir, "resources", "LICENSE.electron.txt"), "utf8"),
      "electron-win-license",
    );
    assert.equal(
      fs.readFileSync(path.join(winOutDir, "resources", "LICENSES.chromium.html"), "utf8"),
      "chromium-win-licenses",
    );

    const incompleteOutDir = path.join(root, "incomplete");
    fs.mkdirSync(path.join(incompleteOutDir, "resources"), { recursive: true });
    await assert.rejects(
      copyElectronRuntimeLicenses({ appOutDir: incompleteOutDir, electronPlatformName: "win32" }),
      /Missing Electron runtime license after extraction/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("release package names identify the operating system and architecture", () => {
  const config = require("../../../electron-builder.config.cjs");
  assert.equal(config.win.artifactName, "${productName}-${version}-windows-${arch}-setup.${ext}");
  assert.equal(config.mac.artifactName, "${productName}-${version}-macos-${arch}.${ext}");
  assert.equal(config.mac.identity, null, "unsigned builds must not discover a local signing identity");
  assert.equal(config.mac.hardenedRuntime, false);
});

test("release workflow builds both macOS architectures and Windows x64", () => {
  const workflow = readText(path.join(__dirname, "../../../.github/workflows/release.yml"));

  assert.match(workflow, /runner: macos-15\n\s+arch: arm64/);
  assert.match(workflow, /runner: macos-15-intel\n\s+arch: x64/);
  assert.match(workflow, /runs-on: windows-2025/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /--draft/);
  assert.match(workflow, /ref: refs\/tags\//);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /environment: release-signing/);
  assert.match(workflow, /npm run sbom:package/);
  assert.match(workflow, /pideck-sbom-macos-arm64\.cdx\.json/);
  assert.match(workflow, /pideck-sbom-macos-x64\.cdx\.json/);
  assert.match(workflow, /pideck-sbom-windows-x64\.cdx\.json/);
  assert.match(workflow, /Smoke packaged PiHost and bundled SDK/);
  assert.match(
    workflow,
    /- name: Attest release artifacts\n\s+if: github\.event\.repository\.private == false\n\s+uses: actions\/attest-build-provenance@[0-9a-f]{40}/,
  );
  assert.match(workflow, /artifact-metadata: write/);
  assert.equal(workflow.match(/--publish never/g)?.length, 2);
  assert.doesNotMatch(workflow, /\n[ ]{4}env:\n[ ]{6}CSC_LINK:/, "signing secrets must not be job-scoped");
  assert.match(workflow, /- name: Build installer\n[\s\S]*?env:\n\s+CSC_LINK:/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d/);
});

test("all GitHub workflows pin third-party actions and limit default permissions", () => {
  const workflowDirectory = path.join(__dirname, "../../../.github/workflows");
  for (const filename of fs.readdirSync(workflowDirectory).filter((entry) => entry.endsWith(".yml"))) {
    const workflow = readText(path.join(workflowDirectory, filename));
    for (const match of workflow.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)) {
      if (match[1].startsWith("./")) continue;
      assert.match(match[2], /^[0-9a-f]{40}$/, `${filename} must pin ${match[1]} to a full commit SHA`);
    }
    assert.match(workflow, /^permissions:\n\s+contents: read/m, `${filename} must declare read-only default permissions`);
  }
});

test("signed macOS packages allow Pi's external native modules", () => {
  const entitlements = fs.readFileSync(
    path.join(__dirname, "../entitlements.mac.plist"),
    "utf8",
  );

  assert.match(entitlements, /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/);
});

test("Pi model summaries omit thinking levels explicitly disabled by the SDK", () => {
  const summary = modelSummary(
    { id: "provider", name: "Provider" },
    {
      id: "model",
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        xhigh: "high",
        max: null,
      },
    },
    true,
  );

  assert.deepEqual(summary.thinkingLevels, ["off", "low", "medium", "high", "xhigh"]);
});

test("Pi 0.84.2 applies project defaultTools when creating an AgentSession", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pideck-pi-settings-"));
  const projectDir = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ defaultTools: ["read", "bash"] }),
  );
  fs.writeFileSync(
    path.join(projectDir, ".pi", "settings.json"),
    JSON.stringify({ defaultTools: ["read", "grep"] }),
  );

  try {
    const sdkUrl = pathToFileURL(path.join(
      __dirname,
      "../../../node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    )).href;
    const { ModelRuntime, SessionManager, SettingsManager, createAgentSession } = await import(sdkUrl);
    const settings = SettingsManager.create(projectDir, agentDir);
    assert.deepEqual(settings.getDefaultTools(), ["read", "grep"]);
    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: false,
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const { session } = await createAgentSession({
      cwd: projectDir,
      agentDir,
      modelRuntime,
      sessionManager: SessionManager.inMemory(projectDir),
    });
    assert.deepEqual(session.getActiveToolNames(), ["read", "grep"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
