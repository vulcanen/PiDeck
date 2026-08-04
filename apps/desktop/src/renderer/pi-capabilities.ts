export interface FallbackCommand {
  name: string;
  description: string;
}

/**
 * Used only while Pi's ResourceLoader is unavailable. The authoritative
 * command list always comes from Pi's built-in slash command catalog.
 */
export const fallbackSlashCommands: FallbackCommand[] = [
  { name: "model", description: "Select model" },
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
  { name: "quit", description: "Quit PiDeck" },
];
