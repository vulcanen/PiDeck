import type { SessionChangeFile, SessionChangeReview } from "@pideck/contracts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const MAX_REVIEW_FILES = 200;
const MAX_REVIEW_FILE_BYTES = 750_000;
const MAX_REVIEW_BASELINE_CONTENT_BYTES = 20_000_000;
const MAX_REVIEW_PATCH_BYTES = 250_000;
const MAX_REVIEW_TOTAL_PATCH_BYTES = 1_000_000;
const GIT_TIMEOUT_MS = 15_000;

type FileSnapshot = {
  exists: boolean;
  content?: Buffer;
  digest?: string;
  binary: boolean;
  truncated: boolean;
};

export interface WorkspaceChangeState {
  cwd: string;
  repoRoot: string;
  scopePrefix: string;
  head?: string;
  dirtyFiles: Map<string, FileSnapshot>;
}

type GenerateUnifiedPatch = (filePath: string, oldContent: string, newContent: string, contextLines?: number) => string;

function execFileBuffer(file: string, args: string[], maxBuffer = 4 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: "buffer",
      maxBuffer,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function git(repoRoot: string, args: string[], maxBuffer?: number): Promise<Buffer> {
  return execFileBuffer("git", ["-C", repoRoot, ...args], maxBuffer);
}

function posixPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function parseNulPaths(output: Buffer): string[] {
  return output.toString("utf8").split("\0").filter(Boolean).map(posixPath);
}

function scopedPath(repoPath: string, scopePrefix: string): string | undefined {
  const normalized = posixPath(repoPath);
  if (!scopePrefix) return normalized;
  const prefix = `${scopePrefix}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : undefined;
}

function repoPath(relativePath: string, scopePrefix: string): string {
  return scopePrefix ? `${scopePrefix}/${relativePath}` : relativePath;
}

async function fileDigest(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

function snapshotFromContent(content: Buffer): FileSnapshot {
  return {
    exists: true,
    content,
    digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    binary: content.includes(0),
    truncated: false,
  };
}

async function snapshotWorkspaceFile(cwd: string, relativePath: string): Promise<FileSnapshot> {
  const absolutePath = path.resolve(cwd, relativePath);
  const relativeCheck = path.relative(path.resolve(cwd), absolutePath);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) return { exists: false, binary: false, truncated: false };
  try {
    const fileStat = await lstat(absolutePath);
    if (fileStat.isSymbolicLink()) return snapshotFromContent(Buffer.from(await readlink(absolutePath), "utf8"));
    if (!fileStat.isFile()) return { exists: false, binary: false, truncated: false };
    if (fileStat.size > MAX_REVIEW_FILE_BYTES) {
      return { exists: true, digest: await fileDigest(absolutePath), binary: false, truncated: true };
    }
    return snapshotFromContent(await readFile(absolutePath));
  } catch {
    return { exists: false, binary: false, truncated: false };
  }
}

async function snapshotGitFile(state: WorkspaceChangeState, relativePath: string): Promise<FileSnapshot> {
  if (!state.head) return { exists: false, binary: false, truncated: false };
  const filePath = repoPath(relativePath, state.scopePrefix);
  const objectPath = `${state.head}:${filePath}`;
  try {
    const objectId = (await git(state.repoRoot, ["rev-parse", "--verify", objectPath], 256 * 1024)).toString("utf8").trim();
    const size = Number((await git(state.repoRoot, ["cat-file", "-s", objectId], 256 * 1024)).toString("utf8").trim());
    if (!Number.isFinite(size) || size > MAX_REVIEW_FILE_BYTES) {
      return { exists: true, digest: `git:${objectId}`, binary: false, truncated: true };
    }
    // Recreate the checked-out representation (including core.autocrlf and
    // configured smudge filters), not the raw Git blob. The review baseline
    // must match what was actually on disk when the turn started.
    return snapshotFromContent(await git(state.repoRoot, ["cat-file", "--filters", `--path=${filePath}`, objectPath], MAX_REVIEW_FILE_BYTES + 64 * 1024));
  } catch {
    return { exists: false, binary: false, truncated: false };
  }
}

async function dirtyPaths(repoRoot: string, head: string | undefined, pathspec: string): Promise<string[]> {
  const outputs = await Promise.all([
    head
      ? git(repoRoot, ["diff", "--no-renames", "--name-only", "-z", head, "--", pathspec])
      : git(repoRoot, ["ls-files", "--cached", "-z", "--", pathspec]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec]),
  ]);
  return [...new Set(outputs.flatMap(parseNulPaths))];
}

export async function captureWorkspaceChangeState(cwd: string): Promise<WorkspaceChangeState | null> {
  const resolvedCwd = path.resolve(cwd);
  try {
    const repoRoot = path.resolve((await execFileBuffer("git", ["-C", resolvedCwd, "rev-parse", "--show-toplevel"], 256 * 1024)).toString("utf8").trim());
    const relativeScope = path.relative(repoRoot, resolvedCwd);
    if (relativeScope.startsWith("..") || path.isAbsolute(relativeScope)) return null;
    const scopePrefix = posixPath(relativeScope === "." ? "" : relativeScope);
    const pathspec = scopePrefix || ".";
    let head: string | undefined;
    try { head = (await git(repoRoot, ["rev-parse", "--verify", "HEAD"], 256 * 1024)).toString("utf8").trim() || undefined; }
    catch { head = undefined; }
    const paths = (await dirtyPaths(repoRoot, head, pathspec))
      .map((entry) => scopedPath(entry, scopePrefix))
      .filter((entry): entry is string => Boolean(entry));
    const dirtyFiles = new Map<string, FileSnapshot>();
    let retainedContentBytes = 0;
    // Bound concurrent reads and retained baseline text. Very dirty repositories
    // still get digest-based attribution without consuming an unbounded heap.
    for (let offset = 0; offset < paths.length; offset += 16) {
      const batchPaths = paths.slice(offset, offset + 16);
      const snapshots = await Promise.all(batchPaths.map((relativePath) => snapshotWorkspaceFile(resolvedCwd, relativePath)));
      for (const [index, snapshot] of snapshots.entries()) {
        if (snapshot.content && retainedContentBytes + snapshot.content.length > MAX_REVIEW_BASELINE_CONTENT_BYTES) {
          snapshot.content = undefined;
          snapshot.truncated = true;
        } else if (snapshot.content) retainedContentBytes += snapshot.content.length;
        dirtyFiles.set(batchPaths[index], snapshot);
      }
    }
    return { cwd: resolvedCwd, repoRoot, scopePrefix, head, dirtyFiles };
  } catch {
    return null;
  }
}

async function headChangedPaths(before: WorkspaceChangeState, after: WorkspaceChangeState): Promise<string[]> {
  if (!before.head || !after.head || before.head === after.head || before.repoRoot !== after.repoRoot) return [];
  try {
    const output = await git(before.repoRoot, ["diff", "--no-renames", "--name-only", "-z", before.head, after.head, "--", before.scopePrefix || "."]);
    return parseNulPaths(output)
      .map((entry) => scopedPath(entry, before.scopePrefix))
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return [];
  }
}

function snapshotsEqual(before: FileSnapshot, after: FileSnapshot): boolean {
  if (before.exists !== after.exists) return false;
  if (!before.exists) return true;
  if (before.content && after.content) return before.content.equals(after.content);
  if (before.digest && after.digest && before.digest.startsWith("sha256:") && after.digest.startsWith("sha256:")) return before.digest === after.digest;
  return false;
}

function decodeText(content: Buffer | undefined): string | undefined {
  if (!content || content.includes(0)) return undefined;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(content); }
  catch { return undefined; }
}

function patchCounts(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function truncatePatch(patch: string, limit: number): string {
  const buffer = Buffer.from(patch, "utf8");
  if (buffer.length <= limit) return patch;
  const prefix = buffer.subarray(0, Math.max(0, limit)).toString("utf8");
  const newline = prefix.lastIndexOf("\n");
  return `${newline >= 0 ? prefix.slice(0, newline + 1) : prefix}\n`;
}

export async function buildSessionChangeReview(
  taskId: string,
  startedAt: number,
  endedAt: number,
  before: WorkspaceChangeState | null,
  after: WorkspaceChangeState | null,
  generateUnifiedPatch: GenerateUnifiedPatch,
  state: SessionChangeReview["state"] = "completed",
): Promise<SessionChangeReview | null> {
  if (!before || !after || before.repoRoot !== after.repoRoot || before.cwd !== after.cwd) return null;
  const candidatePaths = [...new Set([
    ...before.dirtyFiles.keys(),
    ...after.dirtyFiles.keys(),
    ...(await headChangedPaths(before, after)),
  ])].sort((a, b) => a.localeCompare(b));
  const files: SessionChangeFile[] = [];
  let patchBytes = 0;
  let omittedChangedFiles = false;

  for (const relativePath of candidatePaths) {
    const previous = before.dirtyFiles.get(relativePath) ?? await snapshotGitFile(before, relativePath);
    const current = after.dirtyFiles.get(relativePath) ?? await snapshotWorkspaceFile(after.cwd, relativePath);
    if (snapshotsEqual(previous, current)) continue;
    if (files.length >= MAX_REVIEW_FILES) {
      omittedChangedFiles = true;
      continue;
    }
    const oldText = previous.exists ? decodeText(previous.content) : "";
    const newText = current.exists ? decodeText(current.content) : "";
    const binary = previous.binary || current.binary
      || (previous.exists && !previous.truncated && oldText === undefined)
      || (current.exists && !current.truncated && newText === undefined);
    let patch: string | undefined;
    let additions = 0;
    let deletions = 0;
    let truncated = previous.truncated || current.truncated;
    if (!binary && oldText !== undefined && newText !== undefined) {
      // Git's clean/smudge filters can represent a clean baseline with a
      // different EOL convention from the bytes currently on disk. Review the
      // semantic text change so one edited line never appears as a whole-file
      // CRLF/LF replacement.
      const normalizedOldText = oldText.replace(/\r\n?/g, "\n");
      const normalizedNewText = newText.replace(/\r\n?/g, "\n");
      const fullPatch = generateUnifiedPatch(relativePath, normalizedOldText, normalizedNewText, 3);
      ({ additions, deletions } = patchCounts(fullPatch));
      const remaining = Math.max(0, MAX_REVIEW_TOTAL_PATCH_BYTES - patchBytes);
      const limit = Math.min(MAX_REVIEW_PATCH_BYTES, remaining);
      if (Buffer.byteLength(fullPatch, "utf8") > limit) truncated = true;
      if (limit > 0) {
        patch = truncatePatch(fullPatch, limit);
        patchBytes += Buffer.byteLength(patch, "utf8");
      }
    }
    files.push({
      path: relativePath,
      status: !previous.exists ? "added" : !current.exists ? "deleted" : "modified",
      additions,
      deletions,
      ...(patch ? { patch } : {}),
      binary,
      truncated,
    });
  }

  return {
    id: `${taskId}:${startedAt}`,
    state,
    startedAt,
    endedAt,
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    truncated: omittedChangedFiles || files.some((file) => file.truncated),
  };
}
