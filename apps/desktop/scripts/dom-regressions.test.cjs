const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { Window } = require("happy-dom");

function installDom() {
  const dom = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "KeyboardEvent", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle"]) {
    if (key in dom) global[key] = dom[key];
  }
  global.requestAnimationFrame = dom.requestAnimationFrame.bind(dom);
  global.cancelAnimationFrame = dom.cancelAnimationFrame.bind(dom);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

async function flushReact() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("composer highlights recalled Skill and every registered slash command as command tokens", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { highlightComposerText } = require("../dist/renderer/ui/composer.js");
  const root = createRoot(dom.document.body);
  await act(async () => root.render(React.createElement("div", null,
    ...highlightComposerText("/skill:review fix /compact now /permission-system strict", ["compact", "permission-system"]),
  )));
  assert.deepEqual([...dom.document.querySelectorAll("mark")].map((mark) => [mark.textContent, mark.className]), [
    ["/skill:review", "composer-token skill-token"],
    ["/compact", "composer-token command-token"],
    ["/permission-system", "composer-token command-token"],
  ]);
  await act(async () => root.unmount());
  dom.close();
});


test("Windows menu buttons retain edit selection, support keyboard navigation, and recover after errors", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { ApplicationMenu } = require("../dist/renderer/ui/application-menu.js");
  const errors = [];
  const calls = [];
  let closeMenu;
  dom.window.pideck = { app: { popupMenu: (request) => { calls.push(request); return new Promise((resolve) => { closeMenu = resolve; }); } } };
  const root = createRoot(dom.document.body);
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement("textarea", { defaultValue: "keep this selection" }),
    React.createElement(ApplicationMenu, { language: "zh", onError: (error) => errors.push(error) }))));
  const input = dom.document.querySelector("textarea");
  const buttons = [...dom.document.querySelectorAll('[role="menuitem"]')];
  assert.deepEqual(buttons.map((button) => button.textContent), ["编辑", "查看", "帮助"]);
  input.focus();
  input.setSelectionRange(0, 4);
  const down = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 });
  buttons[0].dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  await act(async () => buttons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 })));
  assert.equal(calls[0].menu, "edit");
  assert.equal(dom.document.activeElement, input);
  assert.equal(input.selectionEnd, 4);
  assert.equal(buttons[0].getAttribute("aria-expanded"), "true");
  await act(async () => buttons[0].click());
  assert.equal(calls.length, 1);
  await act(async () => closeMenu());
  await act(async () => buttons[0].focus());
  await act(async () => buttons[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  assert.equal(dom.document.activeElement, buttons[1]);
  await act(async () => buttons[1].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  assert.equal(dom.document.activeElement, input);
  assert.equal(calls[1].menu, "view");
  await act(async () => closeMenu());
  assert.equal(dom.document.activeElement, buttons[1]);
  assert.equal(buttons[1].getAttribute("aria-expanded"), "false");
  const compact = dom.document.querySelector(".application-menu-compact");
  await act(async () => compact.click());
  assert.equal(calls[2].menu, "all");
  await act(async () => closeMenu());
  dom.window.pideck.app.popupMenu = async () => { throw new Error("unavailable"); };
  await act(async () => buttons[0].click());
  assert.match(errors[0], /请重试/);
  assert.equal(buttons[0].getAttribute("aria-expanded"), "false");
  await act(async () => root.unmount());
  dom.close();
});

test("Pi Settings modal blocks global shortcuts while it is open", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { useGlobalShortcuts } = require("../dist/renderer/use-global-shortcuts.js");
  let commandCalls = 0;
  let createCalls = 0;
  let settingsCalls = 0;
  function Probe({ piSettingsOpen = false, quickSettingsOpen = false, packagesOpen = false, extensionUiOpen = false }) {
    useGlobalShortcuts({
      searchInputRef: { current: null },
      settingsOpen: false,
      piSettingsOpen,
      quickSettingsOpen,
      packagesOpen,
      extensionUiOpen,
      commandDialogOpen: false,
      renameOpen: false,
      resumeOpen: false,
      trustOpen: false,
      scopedModelsOpen: false,
      pendingDelete: false,
      pendingProjectRemove: false,
      previewImage: false,
      thinkingMenuOpen: false,
      modelMenuOpen: false,
      suggestionMode: null,
      contextMenu: false,
      projectContextMenu: false,
      imageContextMenu: false,
      onPiCommands: () => { commandCalls += 1; },
      onQuickSettings: () => { settingsCalls += 1; },
      onCreateTask: () => { createCalls += 1; },
      onCloseMenus: () => undefined,
    });
    return React.createElement("button", { type: "button" }, "probe");
  }
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(Probe, { piSettingsOpen: true })); });
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(commandCalls, 0);
  assert.equal(createCalls, 0);
  for (const overlay of ["quickSettingsOpen", "packagesOpen", "extensionUiOpen"]) {
    await act(async () => { root.render(React.createElement(Probe, { [overlay]: true })); });
    for (const key of ["k", "n", ","]) dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(createCalls, 0);
    assert.equal(commandCalls, 0);
    assert.equal(settingsCalls, 0);
  }
  await act(async () => { root.render(React.createElement(Probe, { piSettingsOpen: false })); });
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(commandCalls, 1);
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(settingsCalls, 1);
  await act(async () => { root.unmount(); });
  dom.close();
});

test("Pi Settings can save non-model defaults before a model is configured", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const saved = [];
  let chooseCalls = 0;
  const initialSettings = { defaultThinkingLevel: "medium", transport: "auto", compactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", effectiveExternalEditor: "notepad", externalEditorSource: "default" };
  global.window.pideck = {
    settings: {
      get: async () => initialSettings,
      update: async (value) => { saved.push(value); return { ...initialSettings, ...value }; },
      chooseExternalEditor: async () => { chooseCalls += 1; return '"C:\\Program Files\\Editor\\Editor.exe"'; },
    },
  };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, { language: "en", cwd: "", models: [], onClose: () => undefined, onNotice: () => undefined })); });
  await act(flushReact);
  const save = dom.document.querySelector('[data-testid="pi-settings-save"]');
  assert.ok(save);
  assert.equal(save.disabled, false);
  assert.equal(dom.document.querySelector('[data-testid="pi-external-editor"]'), null);
  const customMode = dom.document.querySelector('[data-testid="pi-external-editor-custom"]');
  assert.ok(customMode);
  await act(async () => { customMode.click(); });
  const editor = dom.document.querySelector('[data-testid="pi-external-editor"]');
  const choose = dom.document.querySelector('[data-testid="pi-external-editor-choose"]');
  assert.ok(editor);
  assert.ok(choose);
  assert.equal(save.disabled, true);
  assert.match(dom.document.querySelector("#pi-external-editor-status").textContent, /notepad/i);
  await act(async () => { choose.click(); await flushReact(); });
  assert.equal(chooseCalls, 1);
  assert.equal(editor.value, '"C:\\Program Files\\Editor\\Editor.exe"');
  assert.equal(save.disabled, false);
  await act(async () => { save.click(); await flushReact(); });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].externalEditor, '"C:\\Program Files\\Editor\\Editor.exe"');
  assert.equal("effectiveExternalEditor" in saved[0], false);
  assert.equal("externalEditorSource" in saved[0], false);
  await act(async () => { root.unmount(); });
  dom.close();
});

test("Pi Settings exposes non-display Pi runtime settings and round-trips them", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const saved = [];
  const initialSettings = {
    defaultThinkingLevel: "medium", transport: "auto", compactionEnabled: true,
    steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", effectiveExternalEditor: "notepad", externalEditorSource: "default",
    retryEnabled: true, retryMaxRetries: 3, retryBaseDelayMs: 2000, compactionReserveTokens: 16384,
    compactionKeepRecentTokens: 20000, httpIdleTimeoutMs: 300000, branchSummaryReserveTokens: 16384,
    providerRetryMaxRetries: 0, providerRetryMaxRetryDelayMs: 60000, websocketConnectTimeoutMs: 15000,
    defaultProjectTrust: "ask", enableSkillCommands: true, imageAutoResize: true, blockImages: false,
    enableInstallTelemetry: true,
  };
  global.window.pideck = { settings: {
    get: async () => initialSettings,
    update: async (value) => { saved.push(value); return { ...initialSettings, ...value }; },
    chooseExternalEditor: async () => null,
  } };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, { language: "en", cwd: "", models: [], onClose: () => undefined, onNotice: () => undefined })); });
  await act(flushReact);
  assert.equal(dom.document.querySelectorAll("select").length, 0);
  assert.equal(dom.document.querySelector('[data-testid="pi-defaultModel"] span').textContent, "Choose model");
  assert.ok(dom.document.querySelector('[data-testid="pi-defaultThinking"]')?.closest("label")?.querySelector("small"));
  assert.ok(dom.document.querySelector('[data-testid="pi-advanced-settings"] .pi-settings-hint'));
  const transport = dom.document.querySelector('[data-testid="pi-transport"]');
  assert.ok(transport);
  await act(async () => {
    transport.click();
    await flushReact();
    const menu = dom.document.getElementById(transport.getAttribute("aria-controls"));
    assert.ok(menu);
    menu.querySelector('[role="option"][data-value="websocket-cached"]').click();
    for (const id of ["pi-blockImages", "pi-enableSkillCommands"]) dom.document.querySelector(`[data-testid="${id}"]`).click();
    assert.ok(dom.document.querySelector('[data-testid="pi-providerRetryTimeoutMs"]'));
    assert.ok(dom.document.querySelector('[data-testid="pi-npmCommand"]'));
    await flushReact();
  });
  await act(async () => { dom.document.querySelector('[data-testid="pi-settings-save"]').click(); await flushReact(); });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].transport, "websocket-cached");
  assert.equal(saved[0].blockImages, true);
  assert.equal(saved[0].enableSkillCommands, false);
  for (const id of ["pi-branchSummarySkipPrompt", "pi-hideThinkingBlock", "pi-showCacheMissNotices", "pi-warningsAnthropicExtraUsage", "pi-enableAnalytics"]) {
    assert.equal(dom.document.querySelector(`[data-testid="${id}"]`), null);
  }
  await act(async () => { root.unmount(); });
  dom.close();
});

test("Pi Settings derives default thinking options from the selected Pi model", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const settings = { defaultProvider: "openai", defaultModel: "gpt-test", defaultThinkingLevel: "high", transport: "auto", compactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", effectiveExternalEditor: "notepad", externalEditorSource: "default" };
  global.window.pideck = { settings: {
    get: async () => settings,
    update: async (value) => ({ ...settings, ...value }),
    chooseExternalEditor: async () => null,
  } };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, {
    language: "en",
    cwd: "",
    models: [{ id: "gpt-test", providerId: "openai", providerName: "OpenAI", name: "GPT Test", reasoning: true, thinkingLevels: ["off", "high", "max"], authConfigured: true }],
    onClose: () => undefined,
    onNotice: () => undefined,
  })); });
  await act(flushReact);
  const thinking = dom.document.querySelector('[data-testid="pi-defaultThinking"]');
  assert.ok(thinking);
  await act(async () => { thinking.click(); await flushReact(); });
  const thinkingMenu = dom.document.getElementById(thinking.getAttribute("aria-controls"));
  assert.ok(thinkingMenu);
  assert.deepEqual([...thinkingMenu.querySelectorAll('[role="option"]')].map((option) => option.dataset.value), ["off", "high", "max"]);
  await act(async () => { root.unmount(); });
  dom.close();
});

test("Pi Settings keeps a portaled select inside the dialog focus boundary", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const settings = { defaultProvider: "openai", defaultModel: "gpt-test", defaultThinkingLevel: "medium", transport: "auto", compactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", effectiveExternalEditor: "notepad", externalEditorSource: "default" };
  global.window.pideck = { settings: { get: async () => settings, update: async (value) => ({ ...settings, ...value }), chooseExternalEditor: async () => null } };
  const root = createRoot(dom.document.body);
  await act(async () => root.render(React.createElement("div", { className: "overlay-root" }, React.createElement(PiSettings, {
    language: "en", cwd: "", models: [{ id: "gpt-test", providerId: "openai", providerName: "OpenAI", name: "GPT Test", reasoning: true, thinkingLevels: ["off", "medium", "high"], authConfigured: true }], onClose: () => undefined, onNotice: () => undefined,
  }))));
  await act(flushReact);
  const thinking = dom.document.querySelector('[data-testid="pi-defaultThinking"]');
  await act(async () => { thinking.click(); await flushReact(); });
  const menu = dom.document.getElementById(thinking.getAttribute("aria-controls"));
  assert.ok(menu);
  assert.equal(menu.closest('[role="dialog"]')?.classList.contains("pi-settings"), true);
  assert.equal(dom.document.activeElement?.getAttribute("role"), "option");
  await act(async () => root.unmount());
  dom.close();
});

test("Pi Settings edits per-model Thinking overrides and sends null to inherit", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const saved = [];
  const settings = {
    defaultProvider: "openai",
    defaultModel: "gpt-test",
    defaultThinkingLevel: "medium",
    modelThinkingLevels: { "openai/gpt-test": "high" },
    transport: "auto",
    compactionEnabled: true,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    effectiveExternalEditor: "notepad",
    externalEditorSource: "default",
  };
  global.window.pideck = { settings: {
    get: async () => settings,
    update: async (value) => { saved.push(value); return { ...settings, ...value }; },
    chooseExternalEditor: async () => null,
  } };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, {
    language: "en",
    cwd: "",
    models: [{ id: "gpt-test", providerId: "openai", providerName: "OpenAI", name: "GPT Test", reasoning: true, thinkingLevels: ["off", "medium", "high", "max"], authConfigured: true }],
    onClose: () => undefined,
    onNotice: () => undefined,
  })); });
  await act(flushReact);
  const modelThinking = dom.document.querySelector('[data-testid="pi-model-thinking-openai-gpt-test"]');
  assert.ok(modelThinking);
  assert.equal(modelThinking.querySelector("span")?.textContent, "high");
  await act(async () => {
    modelThinking.click();
    await flushReact();
    const menu = dom.document.getElementById(modelThinking.getAttribute("aria-controls"));
    assert.ok(menu);
    menu.querySelector('[role="option"][data-value=""]').click();
    await flushReact();
  });
  assert.equal(modelThinking.querySelector("span")?.textContent, "Use global default (medium)");
  const save = dom.document.querySelector('[data-testid="pi-settings-save"]');
  await act(async () => { save.click(); await flushReact(); });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].modelThinkingLevels["openai/gpt-test"], null);
  await act(async () => { root.unmount(); });
  dom.close();
});

test("Pi Settings automatic editor mode clears the user override", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PiSettings } = require("../dist/renderer/ui/pi-settings.js");
  const saved = [];
  const current = { defaultThinkingLevel: "medium", transport: "auto", compactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time", externalEditor: "code --wait", effectiveExternalEditor: "code --wait", externalEditorSource: "user" };
  global.window.pideck = { settings: {
    get: async () => current,
    update: async (value) => { saved.push(value); return { ...current, ...value }; },
    chooseExternalEditor: async () => null,
  } };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, { language: "en", cwd: "", models: [], onClose: () => undefined, onNotice: () => undefined })); });
  await act(flushReact);
  const automaticMode = dom.document.querySelector('[data-testid="pi-external-editor-automatic"]');
  const save = dom.document.querySelector('[data-testid="pi-settings-save"]');
  assert.ok(automaticMode);
  assert.ok(save);
  await act(async () => { automaticMode.click(); });
  assert.equal(dom.document.querySelector('[data-testid="pi-external-editor"]'), null);
  await act(async () => { save.click(); await flushReact(); });
  assert.equal(saved[0].externalEditor, "");
  await act(async () => { root.unmount(); });
  dom.close();
});

test("project trust dialog explains resource access and exposes the effective decision", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { TrustDialog } = require("../dist/renderer/ui/dialogs.js");
  const decisions = [];
  const root = createRoot(dom.document.body);
  const project = { id: "D:/workspace", cwd: "D:/workspace", name: "workspace", taskCount: 0 };
  const status = { cwd: project.cwd, hasTrustRequiringResources: true, trusted: false, source: "default", defaultPolicy: "ask" };
  await act(async () => root.render(React.createElement(TrustDialog, { language: "en", project, status, busy: false, onResolve: (value) => decisions.push(value), onClose: () => undefined })));
  assert.equal(dom.document.querySelector("[data-trust-status]").dataset.trustStatus, "untrusted");
  assert.equal(dom.document.querySelectorAll("[data-trust-action]").length, 2);
  await act(async () => dom.document.querySelector('[data-trust-action="deny"]').click());
  await act(async () => dom.document.querySelector('[data-trust-action="allow"]').click());
  assert.deepEqual(decisions, [false, true]);
  await act(async () => root.render(React.createElement(TrustDialog, { language: "en", project, status: { ...status, hasTrustRequiringResources: false, trusted: true, source: "not-required" }, busy: false, onResolve: (value) => decisions.push(value), onClose: () => undefined })));
  assert.equal(dom.document.querySelector("[data-trust-status]").dataset.trustStatus, "not-required");
  assert.equal(dom.document.querySelectorAll("[data-trust-action]").length, 2);
  await act(async () => root.unmount());
  dom.close();
});

test("Quick settings keeps a compact root and drills into actions and Pi commands", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QuickSettings } = require("../dist/renderer/ui/quick-settings.js");
  const { activatePaletteCommand } = require("../dist/renderer/palette-command.js");
  const commands = [
    { name: "settings", description: "Open Pi settings" },
    { name: "reload", description: "Reload Pi resources" },
    { name: "review", description: "Review this change", source: "skill" },
  ];
  const executed = [];
  const inserted = [];
  const root = createRoot(dom.document.body);
  const noop = () => undefined;
  const actions = {
    executeBuiltin: async (text) => { executed.push(text); return true; },
    insertTemplate: (text) => inserted.push(text),
    executeExtension: async () => assert.fail("not an extension"),
    unsupported: () => assert.fail("supported command"),
  };
  const props = {
    language: "en", commands, shortcut: (key) => key, hasProject: false, hasSession: false,
    onClose: noop, onNewTask: noop, onProviders: noop, onPackages: noop, onCompact: noop, onExport: noop,
    onCommand: (command) => activatePaletteCommand(command, actions),
  };
  await act(async () => root.render(React.createElement(QuickSettings, props)));
  assert.equal(dom.document.querySelectorAll(".quick-settings-menu > button").length, 7);
  assert.equal(dom.document.querySelectorAll('[data-entry="settings"]').length, 1);
  assert.equal(dom.document.querySelector('[data-entry="command:settings"]'), null);
  assert.equal(dom.document.querySelector('[data-entry="command:reload"]'), null);
  assert.equal(dom.document.querySelector('[data-entry="scoped-models"]').disabled, true);
  assert.equal(dom.document.querySelector('[data-entry="trust"]'), null);
  await act(async () => dom.document.querySelector('[data-entry="settings"]').click());
  assert.deepEqual(executed, ["/settings"]);
  await act(async () => dom.document.querySelector('[data-entry="task-actions"]').click());
  assert.equal(dom.document.querySelectorAll(".quick-settings-menu > button").length, 4);
  for (const id of ["new-task", "compact", "export-jsonl", "export-html"]) assert.equal(dom.document.querySelector(`[data-entry="${id}"]`).disabled, true);
  await act(async () => dom.document.querySelector(".quick-settings-back").click());
  await act(async () => dom.document.querySelector('[data-entry="pi-commands"]').click());
  assert.equal(dom.document.querySelectorAll(".quick-settings-group [cmdk-item]").length, 2);
  const input = dom.document.querySelector("input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "/reload");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(dom.document.querySelectorAll(".quick-settings-group [cmdk-item]:not([hidden])").length, 1);
  await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.deepEqual(executed, ["/settings", "/reload"]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "review");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => dom.document.querySelector('[data-entry="command:review"]').click());
  assert.deepEqual(inserted, ["/review "]);
  await act(async () => dom.document.querySelector(".quick-settings-back").click());
  assert.equal(dom.document.querySelector("input"), null);
  await act(async () => root.render(React.createElement(QuickSettings, { ...props, key: "direct-commands", initialPage: "commands" })));
  assert.ok(dom.document.querySelector("input"));
  await act(async () => root.unmount());
  dom.close();
});

test("model selector delegates filtering and keyboard selection to cmdk", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { MemoComposer } = require("../dist/renderer/ui/composer.js");
  const selected = [];
  const noop = () => undefined;
  const models = [
    { id: "alpha", providerId: "one", providerName: "First Provider", name: "Alpha", thinkingLevels: ["off"] },
    { id: "beta", providerId: "two", providerName: "Second Provider", name: "Beta", thinkingLevels: ["off"] },
  ];
  const root = createRoot(dom.document.body);
  await act(async () => root.render(React.createElement(MemoComposer, {
    sessionKey: "cmdk-models", value: "", onChange: noop, onKeyDown: noop, onPaste: noop, onDropImages: noop,
    onExternalEdit: noop, externalEditing: false, onSend: noop, onStop: noop, isSending: false,
    language: "en", activeModel: models[0], modelOptions: models, thinkingLevel: "off", thinkingLevels: ["off"],
    thinkingMenuOpen: false, modelMenuOpen: true, suggestionMode: null, suggestions: [], suggestionIndex: 0,
    commandNames: [], attachments: [], onRemoveAttachment: noop, onPreviewImage: noop, onContextMenuImage: noop,
    onThinkingMenu: noop, onModelMenu: noop, onThinking: noop, onModel: (model) => selected.push(model.id), onSuggestion: noop,
    queueDelivery: "steer", queueState: null, queueMutationBusy: false, queueEdit: null, onQueueDelivery: noop,
    onQueueModes: async () => true, onClearQueue: noop, onPromoteQueue: noop, onEditQueue: noop, onDeleteQueue: noop,
    onCancelQueueEdit: noop,
  })));
  const input = dom.document.querySelector(".model-search input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "Second Provider");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(dom.document.querySelectorAll(".model-menu-list [cmdk-item]:not([hidden])").length, 1);
  await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.deepEqual(selected, ["beta"]);
  await act(async () => root.unmount());
  dom.close();
});

test("model selector wheel stays inside the model list", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { MemoComposer } = require("../dist/renderer/ui/composer.js");
  const noop = () => undefined;
  const models = [
    { id: "alpha", providerId: "one", providerName: "First Provider", name: "Alpha", thinkingLevels: ["off"] },
    { id: "beta", providerId: "two", providerName: "Second Provider", name: "Beta", thinkingLevels: ["off"] },
  ];
  const host = dom.document.createElement("div");
  let bubbledWheels = 0;
  host.addEventListener("wheel", () => { bubbledWheels += 1; });
  dom.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(MemoComposer, {
    sessionKey: "wheel-models", value: "", onChange: noop, onKeyDown: noop, onPaste: noop, onDropImages: noop,
    onExternalEdit: noop, externalEditing: false, onSend: noop, onStop: noop, isSending: false,
    language: "en", activeModel: models[0], modelOptions: models, thinkingLevel: "off", thinkingLevels: ["off"],
    thinkingMenuOpen: false, modelMenuOpen: true, suggestionMode: null, suggestions: [], suggestionIndex: 0,
    commandNames: [], attachments: [], onRemoveAttachment: noop, onPreviewImage: noop, onContextMenuImage: noop,
    onThinkingMenu: noop, onModelMenu: noop, onThinking: noop, onModel: noop, onSuggestion: noop,
    queueDelivery: "steer", queueState: null, queueMutationBusy: false, queueEdit: null, onQueueDelivery: noop,
    onQueueModes: async () => true, onClearQueue: noop, onPromoteQueue: noop, onEditQueue: noop, onDeleteQueue: noop,
    onCancelQueueEdit: noop,
  })));
  const list = dom.document.querySelector(".model-menu-list");
  assert.ok(list);
  const wheel = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
  list.dispatchEvent(wheel);
  assert.equal(bubbledWheels, 0);
  assert.equal(wheel.defaultPrevented, false);
  await act(async () => root.unmount());
  dom.close();
});

test("package install scope is explicit and controls the next install target", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PackageSettings } = require("../dist/renderer/ui/package-settings.js");
  const installs = [];
  const notices = [];
  dom.window.pideck = {
    packages: {
      list: async () => [],
      install: async (...args) => { installs.push(args); },
    },
  };
  const root = createRoot(dom.document.body);
  await act(async () => {
    root.render(React.createElement(PackageSettings, {
      language: "en",
      cwd: "D:\\workspace",
      onClose: () => undefined,
      onNotice: (message) => notices.push(message),
    }));
    await flushReact();
  });
  const projectScope = dom.document.querySelector('input[name="package-install-scope"][value="project"]');
  const userScope = dom.document.querySelector('input[name="package-install-scope"][value="user"]');
  const source = dom.document.querySelector('.package-install-row input[type="text"]');
  assert.equal(projectScope.checked, true);
  assert.equal(userScope.checked, false);
  assert.equal(projectScope.closest("label").classList.contains("selected"), true);
  assert.equal(dom.document.querySelectorAll(".package-install-scope-option small").length, 2);
  await act(async () => {
    userScope.click();
  });
  assert.equal(installs.length, 0);
  assert.equal(projectScope.checked, false);
  assert.equal(userScope.checked, true);
  assert.equal(userScope.closest("label").classList.contains("selected"), true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(source, "npm:demo-package");
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => {
    dom.document.querySelector(".package-install-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await flushReact();
  });
  assert.deepEqual(installs, [["npm:demo-package", false, "D:\\workspace"]]);
  assert.match(notices[0], /User-wide/);
  await act(async () => root.unmount());
  dom.close();
});

test("package enable action reloads state and becomes a disable action", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { PackageSettings } = require("../dist/renderer/ui/package-settings.js");
  const configureCalls = [];
  let disabled = true;
  dom.window.pideck = {
    packages: {
      list: async () => [{ source: "demo-package", scope: "project", filtered: true, disabled, resources: [] }],
      configure: async (_source, enabled) => {
        configureCalls.push(enabled);
        disabled = !enabled;
      },
    },
  };
  const root = createRoot(dom.document.body);
  await act(async () => {
    root.render(React.createElement(PackageSettings, {
      language: "en",
      cwd: "D:\\workspace",
      onClose: () => undefined,
      onNotice: () => undefined,
    }));
    await flushReact();
  });
  const toggle = dom.document.querySelector('[data-package-action="toggle-enabled"]');
  assert.equal(toggle.dataset.packageEnabled, "false");
  await act(async () => { toggle.click(); await flushReact(); });
  assert.deepEqual(configureCalls, [true]);
  assert.equal(toggle.dataset.packageEnabled, "true");
  await act(async () => { toggle.click(); await flushReact(); });
  assert.deepEqual(configureCalls, [true, false]);
  assert.equal(toggle.dataset.packageEnabled, "false");
  await act(async () => root.unmount());
  dom.close();
});

test("palette routing preserves template sources and never sends unknown built-ins to a model", async () => {
  const { activatePaletteCommand } = require("../dist/renderer/palette-command.js");
  const calls = [];
  const actions = {
    insertTemplate: (text) => calls.push(["template", text]),
    executeBuiltin: async (text) => { calls.push(["builtin", text]); return false; },
    executeExtension: async (text) => calls.push(["extension", text]),
    unsupported: () => calls.push(["unsupported"]),
  };
  await activatePaletteCommand({ name: "settings", source: "prompt" }, actions);
  await activatePaletteCommand({ name: "skill:review", source: "skill" }, actions);
  await activatePaletteCommand({ name: "permission-system", source: "extension" }, actions);
  await activatePaletteCommand({ name: "future-command" }, actions);
  assert.deepEqual(calls, [["template", "/settings "], ["template", "/skill:review "], ["extension", "/permission-system"], ["builtin", "/future-command"], ["unsupported"]]);
  await assert.rejects(activatePaletteCommand({ name: "broken", source: "extension" }, { ...actions, executeExtension: async () => { throw new Error("runtime disconnected"); } }), /runtime disconnected/);
});

test("a dialog opened from a disappearing launcher restores workspace focus", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { DialogFocusReturnContext, useDialogFocus } = require("@pideck/ui-system");
  function Dialog({ onClose, onNext }) {
    const ref = React.useRef(null);
    useDialogFocus(ref, onClose);
    return React.createElement("section", { ref, role: "dialog" },
      React.createElement("button", { onClick: onNext ?? onClose }, onNext ? "Next" : "Close"));
  }
  function Probe() {
    const [step, setStep] = React.useState(0);
    const origin = React.useRef(null);
    return React.createElement(DialogFocusReturnContext.Provider, { value: origin },
      React.createElement("button", { ref: origin, id: "origin", onClick: () => setStep(1) }, "Settings"),
      step ? React.createElement(Dialog, { key: step, onClose: () => setStep(0), onNext: step === 1 ? () => setStep(2) : undefined }) : null);
  }
  const root = createRoot(dom.document.body);
  await act(async () => root.render(React.createElement(Probe)));
  const origin = dom.document.getElementById("origin");
  origin.focus();
  await act(async () => origin.click());
  const launcherButton = dom.document.querySelector('[role="dialog"] button');
  launcherButton.focus();
  await act(async () => { launcherButton.click(); await flushReact(); });
  assert.equal(launcherButton.isConnected, false);
  await act(async () => { dom.document.querySelector('[role="dialog"] button').click(); await flushReact(); });
  assert.equal(dom.document.activeElement, origin);
  await act(async () => root.unmount());
  dom.close();
});

test("typing the first transcript-search character does not create a render feedback loop", async (context) => {
  const dom = installDom();
  const originalWarn = console.warn;
  console.warn = (message, ...details) => {
    if (!String(message).startsWith("Warning: KaTeX doesn't work in quirks mode")) originalWarn(message, ...details);
  };
  context.after(() => { console.warn = originalWarn; });
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const previousCssLoader = require.extensions[".css"];
  require.extensions[".css"] = () => undefined;
  const { MemoMessageTimeline } = require("../dist/renderer/ui/message-timeline.js");
  if (previousCssLoader) require.extensions[".css"] = previousCssLoader;
  else delete require.extensions[".css"];
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  const reports = [];
  const messages = [{
    role: "bashExecution",
    command: "echo UI_SEARCH_ALPHA",
    output: "UI_SEARCH_ALPHA\n",
    exitCode: 0,
    cancelled: false,
    timestamp: 1,
    excludeFromContext: false,
  }];

  function Probe() {
    const [query, setQuery] = React.useState("");
    const [request, setRequest] = React.useState({ serial: 0, direction: "forward", reset: true });
    const [result, setResult] = React.useState({ current: 0, total: 0 });
    const conversationRef = React.useRef(null);
    const scrollPositionsRef = React.useRef({});
    const scrollHandleRef = React.useRef(null);
    React.useEffect(() => {
      setQuery("U");
      setRequest({ serial: 1, direction: "forward", reset: true });
    }, []);
    const report = React.useCallback((next) => {
      reports.push(next);
      setResult({ ...next });
    }, []);
    return React.createElement("div", { ref: conversationRef },
      React.createElement(MemoMessageTimeline, {
        messages,
        language: "en",
        running: false,
        activeActivity: [],
        streamText: "",
        workingPhase: null,
        completedActivity: [],
        steeringMessageKeys: [],
        taskId: "search-task",
        scrollKey: "search-project\u0000search-task",
        active: true,
        messageReady: true,
        conversationRef,
        scrollPositionsRef,
        scrollHandleRef,
        onAtEndChange: () => undefined,
        onPreviewImage: () => undefined,
        onContextMenuImage: () => undefined,
        searchQuery: query,
        searchRequest: request,
        onSearchResult: report,
      }),
      React.createElement("output", null, `${result.current}/${result.total}`));
  }

  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(Probe)); await flushReact(); });
  await act(flushReact);
  assert.equal(dom.document.querySelector("output").textContent, "1/1");
  assert.deepEqual(reports, [{ current: 1, total: 1 }]);
  await act(async () => root.unmount());
  dom.close();
});
