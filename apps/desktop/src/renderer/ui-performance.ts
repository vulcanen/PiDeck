export const TERMINAL_OUTPUT_MAX_ENTRIES = 2_000;
export const TERMINAL_OUTPUT_MAX_CHARS = 1_000_000;

export function appendTerminalOutput(current: string[], additions: string[]): string[] {
  const source = [...current, ...additions.filter(Boolean)];
  const kept: string[] = [];
  let characters = 0;
  for (let index = source.length - 1; index >= 0 && kept.length < TERMINAL_OUTPUT_MAX_ENTRIES; index -= 1) {
    const value = source[index] ?? "";
    const remaining = TERMINAL_OUTPUT_MAX_CHARS - characters;
    if (remaining <= 0) break;
    const chunk = value.length > remaining ? value.slice(-remaining) : value;
    kept.push(chunk);
    characters += chunk.length;
  }
  return kept.reverse();
}
