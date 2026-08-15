const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { assertKnownProjectCwd, assertTrustedIpcSender } = require("../dist/main/ipc-security.js");
const { windowThemeColors } = require("../dist/main/window-theme.js");
const { loadQueueForCurrentTask } = require("../dist/renderer/queue-load.js");
const { isPackagedPiAdapter, modelSummary, packagedPiNodeModules } = require("../../../packages/pi-adapter/dist/index.js");
const { copyElectronRuntimeLicenses } = require("../../../scripts/copy-electron-runtime-licenses.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
  const workflow = fs.readFileSync(
    path.join(__dirname, "../../../.github/workflows/release.yml"),
    "utf8",
  );

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
    const workflow = fs.readFileSync(path.join(workflowDirectory, filename), "utf8");
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
