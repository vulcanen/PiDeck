const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  mergeMessageSnapshot,
  messageIdentity,
} = require("../dist/renderer/message-utils.js");
const {
  buildMessageTimelineItems,
  restoreCompletedActivity,
} = require("../dist/renderer/timeline-utils.js");

const rendererSource = (relativePath) => fs.readFileSync(
  path.join(__dirname, "../src/renderer", relativePath),
  "utf8",
);

function message(id, role, text, timestamp) {
  return { id, role, content: text, timestamp };
}

function activity(id) {
  return [{ id, kind: "thinking", label: id, startedAt: 1, endedAt: 2 }];
}

function describeTimeline(items) {
  return items.map((item) => item.type === "execution"
    ? `execution:${item.steps[0]?.id}`
    : item.type === "live"
      ? `live:${item.text}`
    : `message:${item.message.id}`);
}

test("empty project task creation keeps the target project cwd", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/renderer/app-sidebar.tsx"),
    "utf8",
  );

  assert.match(source, /onClick=\{\(\) => void onCreateTaskForProject\(project\)\}/);
});

test("new task creation stays scoped to the current project", () => {
  const controller = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-app-controller.tsx"),
    "utf8",
  );

  // updateTaskLists applies its update to every project's cached list, so a
  // new task must be written to the current project only (regression: creating
  // a task once leaked a phantom session into every other expanded project).
  assert.match(controller, /setTasks\(\(current\) => sortTasksByUpdatedAt\(\[task, \.\.\.current\.filter/);
  assert.doesNotMatch(controller, /updateTaskLists\(\(current\) => sortTasksByUpdatedAt\(\[task, \.\.\.current\.filter/);
});

test("startup restores sessions for every persisted expanded project", () => {
  const controller = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-app-controller.tsx"),
    "utf8",
  );

  assert.match(controller, /const restoredExpandedCwds = new Set\(expandedProjectCwds\)/);
  assert.match(controller, /const restoredExpandedProjects = discoveredProjects\.filter\(\(project\) => project\.cwd !== selectedProject\.cwd && restoredExpandedCwds\.has\(project\.cwd\)\)/);
  assert.match(controller, /await Promise\.all\(restoredExpandedProjects\.map\(\(project\) => loadProjectSessions\(project\)\)\)/);
});

test("execution durations use durable Pi session metadata", () => {
  const host = fs.readFileSync(
    path.join(__dirname, "../../../packages/pi-host/src/index.ts"),
    "utf8",
  );
  const contracts = fs.readFileSync(
    path.join(__dirname, "../../../packages/contracts/src/index.ts"),
    "utf8",
  );
  const sessionData = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-session-data.ts"),
    "utf8",
  );
  const timeline = fs.readFileSync(
    path.join(__dirname, "../src/renderer/timeline-utils.ts"),
    "utf8",
  );
  const runtimeEvents = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-runtime-events.ts"),
    "utf8",
  );
  const executionSummary = rendererSource("ui/execution-summary.tsx");

  assert.match(host, /appendCustomEntry/);
  assert.match(host, /agent_start/);
  assert.match(host, /agent_settled/);
  assert.match(host, /queueDelivery === "followUp"/);
  assert.match(host, /finishExecutionGroup/);
  assert.match(host, /case "sessions\.runMetadata"/);
  assert.match(contracts, /export interface SessionRunRecord/);
  assert.match(contracts, /runMetadata\(taskId: string/);
  assert.match(sessionData, /window\.pideck\.sessions\.runMetadata\(taskId, projectCwd\)/);
  assert.match(sessionData, /restoreCompletedActivity/);
  assert.match(timeline, /durationMs: record\.durationMs/);
  assert.match(runtimeEvents, /applyPersistedRunDurations/);
  assert.match(runtimeEvents, /sessions\.runMetadata\(taskId, projectCwd\)/);
  assert.match(executionSummary, /persistedDurationMs/);
  assert.match(timeline, /persisted:\$\{record\.id\}/);
});

test("name command opens an editable rename dialog without an argument", () => {
  const controller = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-app-controller.tsx"),
    "utf8",
  );
  const dialogs = rendererSource("ui/dialogs.tsx");

  assert.match(controller, /command === "name"\) \{ if \(argument\) await renameSession\(argument\); else if \(activeTask\) setRenameOpen\(true\)/);
  assert.match(dialogs, /function RenameSessionDialog/);
});

test("conversation panes survive project switches and scope scroll snapshots", () => {
  const conversation = fs.readFileSync(
    path.join(__dirname, "../src/renderer/app-conversation.tsx"),
    "utf8",
  );
  const timeline = rendererSource("ui/message-timeline.tsx");

  assert.match(conversation, /cachedPaneKeys/);
  assert.match(conversation, /conversationPaneKey\(task\.projectId, task\.id\)/);
  assert.doesNotMatch(conversation, /<ConversationPaneDeck\s+key=\{projectCwd/);
  assert.match(timeline, /scrollPositionsRef\.current\[scrollKey\]/);
});

test("package enable/disable edits Pi autoload state instead of re-adding sources", () => {
  const host = fs.readFileSync(
    path.join(__dirname, "../../../packages/pi-host/src/index.ts"),
    "utf8",
  );
  const packageSettings = rendererSource("ui/package-settings.tsx");

  assert.match(host, /function configurePackageSource/);
  assert.match(host, /manager\.listConfiguredPackages\?\.\(\)/);
  assert.match(host, /disabled: item\.disabled === true \|\| item\.filtered === true/);
  assert.match(host, /packageConfigRevision/);
  assert.doesNotMatch(host, /function listConfiguredPackages/);
  assert.match(host, /autoload: false/);
  assert.doesNotMatch(host, /payload\.enabled\s*\?\s*manager\.addSourceToSettings/);
  assert.match(packageSettings, /item\.disabled/);
  assert.match(packageSettings, /onPackagesChanged/);
});

test("slash suggestion symbols keep their fixed visual width", () => {
  const styles = fs.readFileSync(
    path.join(__dirname, "../src/renderer/styles.css"),
    "utf8",
  );

  assert.match(styles, /\.suggestion-symbol\s*\{[^}]*flex:\s*0 0 22px/);
});

test("/settings is not exposed as a desktop command", () => {
  const controller = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-app-controller.tsx"),
    "utf8",
  );
  const capabilities = fs.readFileSync(
    path.join(__dirname, "../src/renderer/pi-capabilities.ts"),
    "utf8",
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, "../../../packages/i18n/src/index.ts"),
    "utf8",
  );

  assert.match(controller, /new Set\(\["fork", "clone", "tree", "settings"\]\)/);
  assert.doesNotMatch(controller, /command === "settings"/);
  assert.match(controller, /const removedUiCommands = new Set\(\["settings"\]\)/);
  assert.doesNotMatch(capabilities, /name: "settings"/);
  assert.doesNotMatch(i18n, /^\s*settings:\s*\{/m);
});

test("Pi model metadata follows the current SDK shape", () => {
  const adapter = fs.readFileSync(
    path.join(__dirname, "../../../packages/pi-adapter/src/index.ts"),
    "utf8",
  );

  assert.match(adapter, /model\.thinkingLevelMap/);
  assert.match(adapter, /model\?\.modelId \|\| model\?\.id/);
  assert.doesNotMatch(adapter, /model\?\.provider && model\?\.id\) return/);
});

test("agent_end messages and auth cancellation stay on the bridge", () => {
  const host = fs.readFileSync(
    path.join(__dirname, "../../../packages/pi-host/src/index.ts"),
    "utf8",
  );
  const contracts = fs.readFileSync(
    path.join(__dirname, "../../../packages/contracts/src/index.ts"),
    "utf8",
  );
  const runtimeEvents = fs.readFileSync(
    path.join(__dirname, "../src/renderer/use-runtime-events.ts"),
    "utf8",
  );

  assert.match(host, /type: event\.type, willRetry: event\.willRetry, messages: jsonSafe\(event\.messages\)/);
  assert.match(runtimeEvents, /Array\.isArray\(event\.messages\)/);
  assert.match(host, /cancelled\?: boolean/);
  assert.match(contracts, /resolveAuth\(requestId: string, value: string, cancelled\?: boolean\)/);
  assert.match(host, /waiter\.reject\(new Error\("Authentication cancelled"\)\)/);
  assert.match(host, /await persistProviderApiKey\(runtime, payload\.providerId/);
  assert.doesNotMatch(host, /void runtime\.setRuntimeApiKey/);
});

test("message identity remains stable when Pi omits message ids", () => {
  const value = {
    role: "user",
    timestamp: 42,
    content: [
      { type: "text", text: "hello" },
      { type: "image", mimeType: "image/png", data: "abc" },
    ],
  };
  assert.equal(messageIdentity(value), "message:user|42|hello|image/png");
});

test("incremental snapshots replace optimistic messages without reordering", () => {
  const optimistic = message("local-1", "user", "first", 1);
  const assistant = message("a1", "assistant", "reply", 2);
  const persisted = { role: "user", content: "first", timestamp: 3 };
  const merged = mergeMessageSnapshot([optimistic, assistant], [persisted]);

  assert.deepEqual(merged, [persisted, assistant]);
});

test("authoritative snapshots preserve Pi order instead of timestamp order", () => {
  const optimistic = message("local-1", "user", "queued", 1);
  const liveOnly = message("live", "assistant", "still live", 99);
  const canonical = [
    message("u1", "user", "first", 30),
    message("a1", "assistant", "reply", 10),
    { role: "user", content: "queued", timestamp: 40 },
  ];
  const merged = mergeMessageSnapshot([optimistic, liveOnly], canonical, true);

  assert.deepEqual(merged.map((item) => item.id ?? item.content), ["u1", "a1", "queued", "live"]);
});

test("follow-up messages create distinct logical turns", () => {
  const messages = [
    message("u1", "user", "first", 1),
    message("a1", "assistant", "reply", 2),
    message("u2", "user", "follow up", 3),
    message("a2", "assistant", "reply 2", 4),
  ];
  const items = buildMessageTimelineItems({
    messages,
    language: "en",
    running: false,
    completedActivity: [activity("run-1"), activity("run-2")],
    steeringMessageKeys: [],
  });

  assert.deepEqual(describeTimeline(items), [
    "message:u1",
    "execution:run-1",
    "message:a1",
    "message:u2",
    "execution:run-2",
    "message:a2",
  ]);
});

test("failed model response stays visible instead of being dropped", () => {
  const failed = {
    id: "a-fail",
    role: "assistant",
    content: [{ type: "text", text: "" }],
    stopReason: "error",
    errorMessage: "Codex error: The usage limit has been reached",
    timestamp: 2,
  };
  const items = buildMessageTimelineItems({
    messages: [
      message("u1", "user", "hello", 1),
      failed,
    ],
    language: "en",
    running: false,
    completedActivity: [activity("run-fail")],
    steeringMessageKeys: [],
  });

  assert.deepEqual(describeTimeline(items), [
    "message:u1",
    "execution:run-fail",
    "message:a-fail",
  ]);
});

test("steering messages stay inside one logical turn", () => {
  const steering = message("u-steer", "user", "adjust", 3);
  const messages = [
    message("u1", "user", "first", 1),
    message("a1", "assistant", "partial", 2),
    steering,
    message("a2", "assistant", "adjusted", 4),
  ];
  const items = buildMessageTimelineItems({
    messages,
    language: "en",
    running: false,
    completedActivity: [activity("shared-run")],
    steeringMessageKeys: [messageIdentity(steering)],
  });

  assert.equal(items.filter((item) => item.type === "execution").length, 1);
  assert.deepEqual(items.filter((item) => item.type === "message").map((item) => item.message.id), ["u1", "a1", "u-steer", "a2"]);
});

test("historical turns without metadata do not invent a duration", () => {
  const items = buildMessageTimelineItems({
    messages: [
      message("u1", "user", "first", 1_000),
      message("a1", "assistant", "reply", 4_500),
    ],
    language: "en",
    running: false,
    completedActivity: [],
    steeringMessageKeys: [],
    taskId: "restarted-task",
  });

  const summary = items.find((item) => item.type === "execution");
  assert.equal(Boolean(summary), true);
  assert.equal(summary.steps[0].timing, "unknown");
});

test("session reload keeps Pi thinking and tool details while restoring duration", () => {
  const groups = restoreCompletedActivity([
    message("u1", "user", "inspect", 1_000),
    {
      id: "a1",
      role: "assistant",
      timestamp: 2_000,
      content: [
        { type: "thinking", thinking: "check the workspace" },
        { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
        { type: "text", text: "done" },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tool-1",
      timestamp: 3_000,
      content: [{ type: "text", text: "file contents" }],
    },
  ], "en", [{ id: "run-1", startedAt: 1_000, endedAt: 4_000, durationMs: 3_000 }]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0][0].detail, "check the workspace");
  assert.equal(groups[0].find((step) => step.kind === "tool").result, "file contents");
  assert.equal(groups[0][0].durationMs, 3_000);
});

test("the active final turn keeps a stable summary and response item", () => {
  const messages = [
    message("u1", "user", "first", 1),
  ];
  const items = buildMessageTimelineItems({
    messages,
    language: "en",
    running: true,
    completedActivity: [],
    steeringMessageKeys: [],
    taskId: "task-1",
    activeActivity: activity("active-run"),
    liveText: "partial",
    workingPhase: "responding",
  });

  assert.equal(items.some((item) => item.type === "execution"), true);
  assert.equal(items.some((item) => item.type === "live"), true);
  assert.equal(items.find((item) => item.type === "live").stableKey, "response-task-1-0");

  const settled = buildMessageTimelineItems({
    messages: [...messages, message("a1", "assistant", "partial", 2)],
    language: "en",
    running: false,
    completedActivity: [activity("active-run")],
    steeringMessageKeys: [],
    taskId: "task-1",
  });
  assert.equal(settled.find((item) => item.type === "message" && item.message.id === "a1").stableKey, "response-task-1-0");
});

test("runtime activity aligns to the newest persisted turn", () => {
  const messages = [
    message("u1", "user", "old", 1),
    message("a1", "assistant", "old reply", 2),
    message("u2", "user", "new", 3),
    message("a2", "assistant", "new reply", 4),
  ];
  const items = buildMessageTimelineItems({
    messages,
    language: "en",
    running: false,
    completedActivity: [activity("new-runtime")],
    steeringMessageKeys: [],
  });

  assert.equal(describeTimeline(items).includes("execution:new-runtime"), true);
  assert.equal(describeTimeline(items).indexOf("execution:new-runtime") > describeTimeline(items).indexOf("message:u2"), true);
});

test("long queued histories retain every turn in canonical order", () => {
  const messages = [];
  const completedActivity = [];
  for (let index = 0; index < 500; index += 1) {
    messages.push(message(`u${index}`, "user", `prompt ${index}`, index * 2));
    messages.push(message(`a${index}`, "assistant", `reply ${index}`, index * 2 + 1));
    completedActivity.push(activity(`run-${index}`));
  }
  const items = buildMessageTimelineItems({
    messages,
    language: "en",
    running: false,
    completedActivity,
    steeringMessageKeys: [],
  });

  assert.equal(items.length, 1_500);
  assert.deepEqual(describeTimeline(items).slice(0, 6), [
    "message:u0",
    "execution:run-0",
    "message:a0",
    "message:u1",
    "execution:run-1",
    "message:a1",
  ]);
  assert.deepEqual(describeTimeline(items).slice(-3), [
    "message:u499",
    "execution:run-499",
    "message:a499",
  ]);
});

test("the timeline renders in plain document flow with native scroll anchoring", () => {
  const timeline = rendererSource("ui/message-timeline.tsx");
  const styles = rendererSource("styles.css");

  // Virtualization fights asynchronously sized rows (Mermaid, KaTeX, syntax
  // highlighting): the measurement cache is always one paint stale, which is
  // what produced jumping, overlapping rows and rubber-banding.
  assert.doesNotMatch(timeline, /react-virtual|useVirtualizer|getVirtualItems|measureElement/);
  assert.doesNotMatch(styles, /timeline-virtual-host|timeline-spacer/);
  assert.match(timeline, /className="timeline-list"/);

  // Load-bearing: `overflow-anchor: none` was the virtual-list era setting. With
  // a plain list it is the browser's anchoring that stops late-resolving content
  // above the viewport from moving the reader's position.
  assert.match(styles, /\.conversation-scroll\s*\{[^}]*overflow-anchor:\s*auto/);
  assert.doesNotMatch(styles, /\.conversation-scroll\s*\{[^}]*overflow-anchor:\s*none/);

  // Unbounded mounting would exhaust the renderer heap on long sessions.
  assert.match(timeline, /const FOLD_WINDOW = \d+/);
  assert.match(timeline, /className="timeline-show-earlier"/);
});

test("auto-scroll survives content shrinking and programmatic smooth scrolls", () => {
  const timeline = rendererSource("ui/message-timeline.tsx");

  // Regression: following used to be dropped whenever scrollTop decreased. The
  // transcript legitimately shrinks (live row replaced by the final message, the
  // working indicator disappearing, an execution summary collapsing), so that
  // inference silently killed auto-scroll mid-stream. Only a real upward wheel
  // gesture may opt out now; touch keeps direction inference because it emits no
  // wheel events, and then only while a finger is actually down.
  assert.match(timeline, /if \(event\.deltaY >= 0\) return;/);
  assert.match(timeline, /if \(touchActiveRef\.current && previous && top < previous\.top - 1\)/);
  assert.doesNotMatch(timeline, /const movingAwayFromEnd/);

  // A smooth scroll reports "not at the bottom" for its whole duration, which
  // flashed the jump-to-latest button back on mid-animation.
  assert.match(timeline, /nearBottom \|\| pinningRef\.current/);
  assert.match(timeline, /beginPinning\(\);/);
  assert.match(timeline, /pinningTimeoutRef\.current = window\.setTimeout/);

  // sendPrompt calls scrollToLatest before the optimistic message exists, so the
  // follow intent has to be recorded, not just the current offset.
  assert.match(timeline, /scrollToLatest: \(behavior\) => \{[\s\S]*?setFollow\(true\)/);
});

test("inactive conversation panes stay laid out so the browser keeps their scrollTop", () => {
  const conversation = rendererSource("app-conversation.tsx");
  const styles = rendererSource("styles.css");

  assert.match(conversation, /active \? "is-active" : "is-inactive"/);
  // `display: none` drops the scroll box, which resets scrollTop to 0 and made
  // task switches lose the reader's position. `visibility: hidden` keeps the
  // layout box, so the browser preserves each pane's offset and no manual
  // save/restore logic is needed at all.
  assert.match(styles, /\.conversation-scroll\.is-inactive\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(styles, /\.conversation-scroll\.is-inactive\s*\{[^}]*display:\s*none/);
});

test("markdown math never rewrites fenced code and strips delimiters first", () => {
  const markdown = rendererSource("ui/markdown.tsx");

  // Regression: the \[..\] -> $$ normalizer used to run over the whole document
  // and corrupted the contents of ```latex fences.
  assert.match(markdown, /CODE_OR_MATH/);
  // Regression: a ```latex fence whose body already carries $$ or \[ was fed to
  // KaTeX verbatim, so the delimiters have to be stripped before the language
  // tag is trusted.
  assert.match(markdown, /parseMathCode/);
  assert.match(markdown, /KATEX_MACROS/);
});
