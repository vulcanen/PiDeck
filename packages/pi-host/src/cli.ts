#!/usr/bin/env node
import { loadPiSdk } from "@pideck/pi-adapter";

async function run(): Promise<void> {
  const sdk = await loadPiSdk();
  if (!sdk.main) throw new Error("The installed Pi runtime does not expose its official CLI entry point");
  // Keep this entry point deliberately transparent. Pi owns argument parsing,
  // stdout/stderr, stdin JSONL, auth printing, sessions, and exit semantics.
  await sdk.main(process.argv.slice(2));
}

void run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
