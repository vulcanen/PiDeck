const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { assertKnownProjectCwd, assertTrustedIpcSender } = require("../dist/main/ipc-security.js");
const { windowThemeColors } = require("../dist/main/window-theme.js");
const { loadQueueForCurrentTask } = require("../dist/renderer/queue-load.js");

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
    "/node_modules/react/index.js",
  ];

  assert.deepEqual(validatePackagePaths(runtimePaths), { fileCount: 5, requiredCount: 4 });
  assert.throws(() => validatePackagePaths([...runtimePaths, "/.codex/session.json"]), /Forbidden development files/);
  assert.throws(() => validatePackagePaths([...runtimePaths, "/apps/desktop/src/main/index.ts"]), /Forbidden development files/);
});

test("native window colors follow the Renderer theme contract", () => {
  assert.deepEqual(windowThemeColors("dark"), { background: "#1f1e1b", symbol: "#f3f0e8" });
  assert.deepEqual(windowThemeColors("light"), { background: "#f7f6f1", symbol: "#27251f" });
});

test("each platform package target inherits the runtime whitelist", () => {
  const config = require("../../../electron-builder.config.cjs");
  for (const target of [config.win.files, config.mac.files]) {
    assert.ok(target.includes("apps/desktop/dist/**/*"));
    assert.ok(target.includes("packages/pi-host/dist/**/*"));
    assert.ok(target.includes("!apps/desktop/src/**/*"));
    assert.equal(target.includes("node_modules/**/*"), false);
  }
});
