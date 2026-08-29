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

test("Pi Settings modal blocks global shortcuts while it is open", async () => {
  const dom = installDom();
  const { createRoot } = require("react-dom/client");
  const { act } = React;
  const { useGlobalShortcuts } = require("../dist/renderer/use-global-shortcuts.js");
  let paletteCalls = 0;
  let createCalls = 0;
  function Probe({ piSettingsOpen }) {
    useGlobalShortcuts({
      searchInputRef: { current: null },
      paletteOpen: false,
      settingsOpen: false,
      piSettingsOpen,
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
      onProviderSettings: () => undefined,
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
  await act(async () => { root.render(React.createElement(Probe, { piSettingsOpen: false })); });
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(paletteCalls, 1);
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
