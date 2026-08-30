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
  let paletteCalls = 0;
  let createCalls = 0;
  let settingsCalls = 0;
  function Probe({ piSettingsOpen = false, quickSettingsOpen = false, packagesOpen = false, extensionUiOpen = false }) {
    useGlobalShortcuts({
      searchInputRef: { current: null },
      paletteOpen: false,
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
      onCommandPalette: () => { paletteCalls += 1; },
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
  assert.equal(paletteCalls, 0);
  assert.equal(createCalls, 0);
  for (const overlay of ["quickSettingsOpen", "packagesOpen", "extensionUiOpen"]) {
    await act(async () => { root.render(React.createElement(Probe, { [overlay]: true })); });
    for (const key of ["k", "n", ","]) dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(paletteCalls, 0);
    assert.equal(createCalls, 0);
    assert.equal(settingsCalls, 0);
  }
  await act(async () => { root.render(React.createElement(Probe, { piSettingsOpen: false })); });
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(paletteCalls, 1);
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
  global.window.pideck = {
    settings: {
      get: async () => ({ defaultThinkingLevel: "medium", transport: "auto", compactionEnabled: true, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" }),
      update: async (value) => { saved.push(value); return value; },
    },
  };
  const root = createRoot(dom.document.body);
  await act(async () => { root.render(React.createElement(PiSettings, { language: "en", cwd: "", models: [], onClose: () => undefined, onNotice: () => undefined })); });
  await act(flushReact);
  const save = dom.document.querySelector('[data-testid="pi-settings-save"]');
  assert.ok(save);
  assert.equal(save.disabled, false);
  await act(async () => { save.click(); await flushReact(); });
  assert.equal(saved.length, 1);
  await act(async () => { root.unmount(); });
  dom.close();
});

test("palette click and Enter execute settings immediately without inserting a draft", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { CommandPalette } = require("../dist/renderer/ui/command-palette.js");
  const { activatePaletteCommand } = require("../dist/renderer/palette-command.js");
  const commands = [{ name: "settings", description: "Open Pi settings" }];
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
  await act(async () => root.render(React.createElement(CommandPalette, {
    language: "en", commands, shortcut: (key) => key, onClose: noop, onNewTask: noop,
    onSettings: noop, onProviders: noop, onPackages: noop,
    onCommand: (command) => activatePaletteCommand(command, actions),
  })));
  const commandButton = [...dom.document.querySelectorAll("button")].find((button) => button.textContent.includes("/settings"));
  await act(async () => commandButton.click());
  assert.deepEqual(executed, ["/settings"]);
  // Four quick actions precede the first command; keyboard activation shares the click path.
  const input = dom.document.querySelector("input");
  for (let index = 0; index < 4; index++) await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.deepEqual(executed, ["/settings", "/settings"]);
  assert.deepEqual(inserted, []);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, " /settings ");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(dom.document.querySelectorAll(".palette-group button").length, 1);
  await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  assert.deepEqual(executed, ["/settings", "/settings", "/settings"]);
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

test("quick settings exposes existing panels and skips unavailable project/session actions", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { QuickSettings } = require("../dist/renderer/ui/quick-settings.js");
  const calls = [];
  const root = createRoot(dom.document.body);
  const props = { language: "en", hasProject: false, hasSession: false,
    onCommand: ({ name }) => calls.push(name), onProviders: () => calls.push("providers"),
    onPackages: () => calls.push("packages"), onClose: () => undefined };
  await act(async () => root.render(React.createElement(QuickSettings, props)));
  const items = [...dom.document.querySelectorAll('[role="menuitem"]')];
  assert.equal(items.length, 6);
  const { icons } = require("@pideck/ui-system");
  assert.ok(icons.settings);
  assert.notEqual(icons.settings, icons.file);
  assert.equal(items[0].querySelector("svg path").getAttribute("d"), icons.settings);
  assert.equal(items[0].querySelector("svg").getAttribute("viewBox"), "0 0 16 16");
  assert.ok(icons.brain);
  assert.equal(items[1].querySelector("svg path").getAttribute("d"), icons.brain);
  assert.equal(items[3].disabled, true);
  assert.equal(items[4].disabled, true);
  items[2].focus();
  await act(async () => items[2].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  assert.equal(dom.document.activeElement, items[5]);
  await act(async () => root.render(React.createElement(QuickSettings, { ...props, hasProject: true, hasSession: true })));
  for (const item of dom.document.querySelectorAll('[role="menuitem"]')) await act(async () => item.click());
  assert.deepEqual(calls, ["settings", "providers", "packages", "scoped-models", "trust", "hotkeys"]);
  await act(async () => root.unmount());
  dom.close();
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
