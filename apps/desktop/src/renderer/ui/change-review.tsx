import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SessionChangeFile, SessionChangeReview } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import { PaneResizeHandle } from "./pane-resize-handle";

type DiffLine = {
  key: string;
  kind: "context" | "addition" | "deletion" | "hunk" | "meta";
  oldLine?: number;
  newLine?: number;
  marker: string;
  text: string;
};

type ChangeFileTreeNode = ChangeFileTreeDirectory | ChangeFileTreeFile;
type ChangeFileTreeDirectory = {
  kind: "directory";
  name: string;
  path: string;
  children: ChangeFileTreeNode[];
  fileCount: number;
};
type ChangeFileTreeFile = {
  kind: "file";
  name: string;
  path: string;
  file: SessionChangeFile;
};
type MutableDirectory = {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: ChangeFileTreeFile[];
};

function parseUnifiedPatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const [index, rawLine] of patch.split("\n").entries()) {
    if (rawLine.startsWith("--- ") || rawLine.startsWith("+++ ") || /^={3,}$/.test(rawLine)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(rawLine);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ key: `hunk-${index}`, kind: "hunk", marker: "", text: rawLine });
      continue;
    }
    if (rawLine.startsWith("+")) {
      lines.push({ key: `add-${index}`, kind: "addition", newLine, marker: "+", text: rawLine.slice(1) });
      newLine += 1;
    } else if (rawLine.startsWith("-")) {
      lines.push({ key: `delete-${index}`, kind: "deletion", oldLine, marker: "−", text: rawLine.slice(1) });
      oldLine += 1;
    } else if (rawLine.startsWith(" ")) {
      lines.push({ key: `context-${index}`, kind: "context", oldLine, newLine, marker: "", text: rawLine.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else if (rawLine) {
      lines.push({ key: `meta-${index}`, kind: "meta", marker: "", text: rawLine });
    }
  }
  return lines;
}

function statusLabel(file: SessionChangeFile, language: Language): string {
  const t = copy[language];
  if (file.status === "added") return t.changeReviewAdded;
  if (file.status === "deleted") return t.changeReviewDeleted;
  return t.changeReviewModified;
}

function statusMark(file: SessionChangeFile): string {
  if (file.status === "added") return "A";
  if (file.status === "deleted") return "D";
  return "M";
}

function buildChangeFileTree(files: SessionChangeFile[]): ChangeFileTreeNode[] {
  const root: MutableDirectory = { name: "", path: "", directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replaceAll("\\", "/").split("/").filter(Boolean);
    if (!parts.length) continue;
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      const path = directory.path ? `${directory.path}/${part}` : part;
      let child = directory.directories.get(part);
      if (!child) {
        child = { name: part, path, directories: new Map(), files: [] };
        directory.directories.set(part, child);
      }
      directory = child;
    }
    directory.files.push({ kind: "file", name: parts.at(-1) ?? file.path, path: file.path, file });
  }

  const finalize = (directory: MutableDirectory): ChangeFileTreeNode[] => {
    const directories = [...directory.directories.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map<ChangeFileTreeDirectory>((child) => {
        const children = finalize(child);
        return {
          kind: "directory",
          name: child.name,
          path: child.path,
          children,
          fileCount: children.reduce((count, node) => count + (node.kind === "file" ? 1 : node.fileCount), 0),
        };
      });
    const directFiles = [...directory.files].sort((left, right) => left.name.localeCompare(right.name));
    return [...directories, ...directFiles];
  };
  return finalize(root);
}

function directoryAncestors(filePath: string): string[] {
  const parts = filePath.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function compactDirectory(directory: ChangeFileTreeDirectory): { directory: ChangeFileTreeDirectory; label: string } {
  const labels = [directory.name];
  let current = directory;
  while (current.children.length === 1 && current.children[0]?.kind === "directory") {
    current = current.children[0];
    labels.push(current.name);
  }
  return { directory: current, label: labels.join("/") };
}

function ChangeReviewFileTree({
  files,
  selectedPath,
  language,
  onSelect,
}: {
  files: SessionChangeFile[];
  selectedPath: string | null;
  language: Language;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildChangeFileTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedPath) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of directoryAncestors(selectedPath)) next.add(path);
      return next;
    });
  }, [selectedPath]);

  const renderNodes = (nodes: ChangeFileTreeNode[], depth: number): ReactNode => nodes.map((node) => {
    if (node.kind === "file") {
      const file = node.file;
      return <button
        type="button"
        className={`change-review-tree-row change-review-tree-file ${file.path === selectedPath ? "active" : ""}`}
        style={{ "--change-review-tree-depth": depth } as CSSProperties}
        key={file.path}
        title={file.path}
        onClick={() => onSelect(file.path)}
      >
        <span className={`change-review-status ${file.status}`} title={statusLabel(file, language)}>{statusMark(file)}</span>
        <span className="change-review-tree-label">{node.name}</span>
        <small><b className="diff-addition">+{file.additions}</b><b className="diff-deletion">−{file.deletions}</b></small>
      </button>;
    }
    const compacted = compactDirectory(node);
    const directory = compacted.directory;
    const isExpanded = expanded.has(directory.path);
    return <div className="change-review-tree-branch" key={node.path}>
      <button
        type="button"
        className={`change-review-tree-row change-review-tree-directory ${isExpanded ? "expanded" : ""}`}
        style={{ "--change-review-tree-depth": depth } as CSSProperties}
        title={directory.path}
        aria-expanded={isExpanded}
        onClick={() => setExpanded((current) => {
          const next = new Set(current);
          if (isExpanded) next.delete(directory.path);
          else next.add(directory.path);
          return next;
        })}
      >
        <span className="change-review-tree-chevron"><Icon name="chevron" size={12} /></span>
        <Icon name={isExpanded ? "folderOpen" : "folder"} size={14} />
        <span className="change-review-tree-label">{compacted.label}</span>
        <span className="change-review-tree-dot" aria-hidden="true" />
      </button>
      {isExpanded && <div className="change-review-tree-children">{renderNodes(directory.children, depth + 1)}</div>}
    </div>;
  });

  return <div className="change-review-file-tree">{renderNodes(tree, 0)}</div>;
}

function reviewRunLabel(review: SessionChangeReview, index: number, total: number, language: Language): string {
  const t = copy[language];
  const suffix = review.state === "running"
    ? t.changeReviewCurrent
    : new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" }).format(review.startedAt);
  return `${t.changeReviewRun(index + 1, total)} · ${suffix}`;
}

function ChangeReviewPanel({
  reviews,
  selectedReview,
  language,
  loading,
  fileListWidth,
  onFileListWidth,
  onSelectReview,
  onClose,
}: {
  reviews: SessionChangeReview[];
  selectedReview: SessionChangeReview | null;
  language: Language;
  loading: boolean;
  fileListWidth: number;
  onFileListWidth: (width: number) => void;
  onSelectReview: (reviewId: string) => void;
  onClose: () => void;
}) {
  const t = copy[language];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const runPickerRef = useRef<HTMLDivElement>(null);
  const runPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedFile = selectedReview?.files.find((file) => file.path === selectedPath) ?? selectedReview?.files[0] ?? null;
  const selectedReviewIndex = selectedReview ? reviews.findIndex((review) => review.id === selectedReview.id) : -1;
  const diffLines = useMemo(() => selectedFile?.patch ? parseUnifiedPatch(selectedFile.patch) : [], [selectedFile]);

  useEffect(() => {
    if (!selectedReview?.files.some((file) => file.path === selectedPath)) setSelectedPath(selectedReview?.files[0]?.path ?? null);
  }, [selectedPath, selectedReview]);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => setBodyWidth(body.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [selectedReview?.id]);
  useEffect(() => {
    if (!runPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !runPickerRef.current?.contains(event.target)) setRunPickerOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [runPickerOpen]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (runPickerOpen) {
        setRunPickerOpen(false);
        window.requestAnimationFrame(() => runPickerTriggerRef.current?.focus());
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, runPickerOpen]);

  const minimumFileListWidth = 170;
  const maximumFileListWidth = Math.max(minimumFileListWidth, bodyWidth - 300);
  const effectiveFileListWidth = Math.min(maximumFileListWidth, Math.max(minimumFileListWidth, fileListWidth));
  const runPickerDisabled = loading || reviews.length === 0 || !selectedReview;

  return <aside className="change-review-panel" aria-labelledby="change-review-title">
    <header className="change-review-header">
      <div><Icon name="diff" size={15} /><strong id="change-review-title">{t.changeReview}</strong></div>
      <button type="button" className="icon-button" title={t.changeReviewClose} aria-label={t.changeReviewClose} onClick={onClose}><Icon name="x" size={13} /></button>
    </header>
    <div className="change-review-toolbar">
      <div className="change-review-run-picker" ref={runPickerRef}>
        <button
          ref={runPickerTriggerRef}
          type="button"
          className="change-review-run-trigger"
          aria-label={t.changeReviewSelectRun}
          aria-haspopup="listbox"
          aria-expanded={runPickerOpen}
          disabled={runPickerDisabled}
          onClick={() => setRunPickerOpen((current) => !current)}
        >
          <span>{selectedReview && selectedReviewIndex >= 0 ? reviewRunLabel(selectedReview, selectedReviewIndex, reviews.length, language) : t.changeReviewSelectRun}</span>
          <Icon name="chevron" size={13} />
        </button>
        {runPickerOpen && <div
          className="change-review-run-menu"
          role="listbox"
          aria-label={t.changeReviewSelectRun}
          onKeyDown={(event) => {
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[role='option']"));
            const current = options.indexOf(document.activeElement as HTMLButtonElement);
            let next = -1;
            if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % options.length;
            else if (event.key === "ArrowUp") next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setRunPickerOpen(false);
              runPickerTriggerRef.current?.focus();
              return;
            }
            if (next >= 0) {
              event.preventDefault();
              options[next]?.focus();
            }
          }}
        >
          {reviews.map((review, index) => {
            const selected = review.id === selectedReview?.id;
            return <button
              type="button"
              role="option"
              aria-selected={selected}
              className={selected ? "selected" : ""}
              autoFocus={selected}
              value={review.id}
              key={review.id}
              onClick={() => {
                onSelectReview(review.id);
                setRunPickerOpen(false);
                runPickerTriggerRef.current?.focus();
              }}
            >
              <span>{reviewRunLabel(review, index, reviews.length, language)}</span>
              {selected && <Icon name="check" size={13} />}
            </button>;
          })}
        </div>}
      </div>
      {selectedReview && <div className="change-review-totals"><span>{t.changeReviewFiles(selectedReview.files.length)}</span><strong className="diff-addition">+{selectedReview.additions}</strong><strong className="diff-deletion">−{selectedReview.deletions}</strong></div>}
    </div>
    {loading
      ? <div className="change-review-empty" role="status"><span className="conversation-spinner" aria-hidden="true" /><span>{t.loading}</span></div>
      : !selectedReview?.files.length
      ? <div className="change-review-empty"><Icon name="check" size={18} /><span>{t.changeReviewNoChanges}</span></div>
      : <div ref={bodyRef} className="change-review-body" style={{ "--change-review-files-width": `${effectiveFileListWidth}px` } as CSSProperties}>
          <section className="change-review-diff" aria-label={selectedFile?.path}>
            {selectedFile && <>
              <header className="change-review-file-header">
                <div><span className={`change-review-status ${selectedFile.status}`} title={statusLabel(selectedFile, language)}>{statusMark(selectedFile)}</span><strong title={selectedFile.path}>{selectedFile.path}</strong></div>
                <span><b className="diff-addition">+{selectedFile.additions}</b><b className="diff-deletion">−{selectedFile.deletions}</b></span>
              </header>
              <div className="change-review-code" role="table" aria-label={selectedFile.path}>
                {diffLines.map((line) => <div className={`change-review-line ${line.kind}`} role="row" key={line.key}>
                  <span className="change-review-line-number" role="cell">{line.oldLine ?? ""}</span>
                  <span className="change-review-line-number" role="cell">{line.newLine ?? ""}</span>
                  <span className="change-review-line-marker" role="cell">{line.marker}</span>
                  <code role="cell">{line.text || " "}</code>
                </div>)}
                {diffLines.length === 0 && <div className="change-review-no-patch"><Icon name="file" size={17} /><span>{selectedFile.binary ? t.changeReviewBinary : t.changeReviewNoPatch}</span></div>}
              </div>
              {(selectedFile.truncated || selectedReview.truncated) && <div className="change-review-warning"><Icon name="alert" size={13} /><span>{t.changeReviewTruncated}</span></div>}
            </>}
          </section>
          <PaneResizeHandle
            className="change-review-files-resize-handle"
            label={t.changeReviewResizeFiles}
            value={effectiveFileListWidth}
            minimum={minimumFileListWidth}
            maximum={maximumFileListWidth}
            direction={-1}
            onChange={onFileListWidth}
          />
          <nav className="change-review-files" aria-label={t.changeReviewFileList}>
            <div className="change-review-files-title"><span>{t.changeReviewFileList}</span><small>{selectedReview.files.length}</small></div>
            <ChangeReviewFileTree files={selectedReview.files} selectedPath={selectedFile?.path ?? null} language={language} onSelect={setSelectedPath} />
          </nav>
        </div>}
  </aside>;
}

function ChangeReviewLauncher({ review, language, onOpen }: { review: SessionChangeReview; language: Language; onOpen: () => void }) {
  const t = copy[language];
  return <div className="change-review-launcher-wrap"><button type="button" className={`change-review-launcher ${review.state === "running" ? "running" : ""}`} title={t.changeReviewOpen} onClick={onOpen}>
    <Icon name="diff" size={13} />
    <span>{review.state === "running" ? t.changeReviewCurrent : t.changeReviewLatest} · {t.changeReviewFiles(review.files.length)}</span>
    <strong className="diff-addition">+{review.additions}</strong>
    <strong className="diff-deletion">−{review.deletions}</strong>
    <Icon name="chevron" size={11} />
  </button></div>;
}

export { ChangeReviewLauncher, ChangeReviewPanel };
