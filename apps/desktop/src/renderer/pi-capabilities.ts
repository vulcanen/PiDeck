export interface FallbackCommand {
  name: string;
  description: string;
  source?: "extension";
}

/**
 * Used only while Pi's ResourceLoader is unavailable. The authoritative
 * command list always comes from Pi's built-in slash command catalog.
 */
export const fallbackSlashCommands: FallbackCommand[] = [
  { name: "model", description: "Select model" },
  { name: "thinking", description: "Set thinking level" },
  { name: "scoped-models", description: "Configure model cycling" },
  { name: "export", description: "Export the current session" },
  { name: "import", description: "Import a JSONL session" },
  { name: "name", description: "Rename the current session" },
  { name: "session", description: "Show session information" },
  { name: "login", description: "Configure Provider authentication" },
  { name: "logout", description: "Remove Provider authentication" },
  { name: "new", description: "Start a new session" },
  { name: "compact", description: "Compact the current context" },
  { name: "resume", description: "Resume another session" },
  { name: "reload", description: "Reload Pi resources" },
  { name: "settings", description: "Configure Pi defaults" },
  { name: "share", description: "Share the current session" },
  { name: "copy", description: "Copy the last assistant message" },
  { name: "changelog", description: "View the Pi changelog" },
  { name: "hotkeys", description: "View keyboard shortcuts" },
  { name: "trust", description: "Manage workspace trust" },
  { name: "quit", description: "Quit PiDeck" },
];
