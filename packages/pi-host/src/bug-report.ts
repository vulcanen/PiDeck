import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePiModule } from "@pideck/pi-adapter";

async function piCoreModule(name: string): Promise<any> {
  const file = path.join(path.dirname(resolvePiModule()), "core", `${name}.js`);
  if (!existsSync(file)) throw new Error(`The installed Pi SDK does not expose ${name}. Install the PiDeck-supported Pi SDK version.`);
  return import(pathToFileURL(file).href);
}

/** Adapt Pi's bug-report bundle helpers without starting a second CLI session. */
export async function createPiBugReport(session: any, options: {
  hint?: string;
  includeSession: boolean;
  delivery: "zip" | "upload";
  outputPath?: string;
}): Promise<{ id: string; path?: string }> {
  if (session.isStreaming || session.isCompacting) throw new Error("Wait for the current Pi run to finish before reporting a bug");
  if (options.delivery === "upload" && process.env.PI_OFFLINE) throw new Error("Pi offline mode prevents bug report uploads. Export a ZIP instead.");
  if (options.delivery === "zip" && !options.outputPath) throw new Error("A ZIP output path is required");
  const [bug, crashes, exportApi, uploader] = await Promise.all([
    piCoreModule("bug-report"), piCoreModule("crash-log"), piCoreModule("session-export"),
    options.delivery === "upload" ? piCoreModule("bug-report-upload") : Promise.resolve(undefined),
  ]);
  const extensions = session.resourceLoader.getExtensions();
  const bundle = {
    metadata: bug.collectBugReportMetadata({
      hint: options.hint || undefined,
      sessionId: session.sessionId,
      cwd: session.sessionManager.getCwd(),
      includeSession: options.includeSession,
      includeSummary: false,
      messageCount: session.messages.length,
      model: session.model,
      modelRuntime: session.modelRuntime,
      thinkingLevel: session.thinkingLevel,
      extensions: extensions.extensions,
      extensionErrors: extensions.errors,
      globalSettings: session.settingsManager.getGlobalSettings(),
      projectSettings: session.settingsManager.getProjectSettings(),
    }),
    diagnostics: bug.collectBugReportDiagnostics(session.sessionManager, crashes.readCrashLog()),
    ...(options.includeSession ? { sessionJsonl: exportApi.serializeSessionBranch(session.sessionManager) } : {}),
  };
  let reportPath: string | undefined;
  let uploadedId: string | undefined;
  if (options.delivery === "zip") {
    reportPath = path.resolve(options.outputPath!);
    await bug.writeBugReportArchive(bundle, reportPath);
  } else {
    uploadedId = (await uploader.uploadBugReport(bundle)).id;
  }
  session.sessionManager.appendCustomEntry(bug.BUG_REPORT_CUSTOM_ENTRY_TYPE, {
    id: bundle.metadata.id,
    createdAt: bundle.metadata.createdAt,
    hint: bundle.metadata.hint,
    sessionIncluded: options.includeSession,
    summaryIncluded: false,
    delivery: options.delivery,
    ...(reportPath ? { path: reportPath } : {}),
  });
  if (bundle.diagnostics.crashes.length) crashes.clearCrashLog();
  return { id: uploadedId ?? bundle.metadata.id, ...(reportPath ? { path: reportPath } : {}) };
}
