const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mergeMessageSnapshot,
  messageIdentity,
} = require("../dist/renderer/message-utils.js");
const {
  buildMessageTimelineItems,
} = require("../dist/renderer/timeline-utils.js");
const {
  appendTerminalOutput,
  TERMINAL_OUTPUT_MAX_CHARS,
  TERMINAL_OUTPUT_MAX_ENTRIES,
} = require("../dist/renderer/ui-performance.js");

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

test("historical turns rebuild a compact processed summary after restart", () => {
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
  assert.equal(summary.steps[0].startedAt, 1_000);
  assert.equal(summary.steps[0].endedAt, 4_500);
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

test("terminal output keeps the newest bounded buffer", () => {
  const current = Array.from({ length: TERMINAL_OUTPUT_MAX_ENTRIES }, (_, index) => `old-${index}`);
  const result = appendTerminalOutput(current, ["newest"]);

  assert.equal(result.length, TERMINAL_OUTPUT_MAX_ENTRIES);
  assert.equal(result.at(-1), "newest");
  assert.equal(result.includes("old-0"), false);
  assert.equal(result.length <= TERMINAL_OUTPUT_MAX_ENTRIES, true);
  assert.equal(result.join("").length <= TERMINAL_OUTPUT_MAX_CHARS, true);
});
