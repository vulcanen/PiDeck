import type { PiSettingsSummary, PiSettingsUpdate } from "@pideck/contracts";

export interface PiSettingsManager {
  getDefaultProvider(): string | undefined;
  getDefaultModel(): string | undefined;
  getDefaultThinkingLevel(): string | undefined;
  getTransport(): PiSettingsSummary["transport"] | undefined;
  getCompactionSettings(): { enabled?: boolean } | undefined;
  getSteeringMode(): PiSettingsSummary["steeringMode"];
  getFollowUpMode(): PiSettingsSummary["followUpMode"];
  setDefaultModelAndProvider(provider: string, model: string): void;
  setDefaultThinkingLevel(level: string): void;
  setTransport(transport: PiSettingsSummary["transport"]): void;
  setCompactionEnabled(enabled: boolean): void;
  setSteeringMode(mode: PiSettingsSummary["steeringMode"]): void;
  setFollowUpMode(mode: PiSettingsSummary["followUpMode"]): void;
  flush(): Promise<void>;
}

export interface PiSettingsRuntime {
  getModel(provider: string, model: string): unknown;
}

export function summarizePiSettings(manager: PiSettingsManager): PiSettingsSummary {
  const compaction = manager.getCompactionSettings();
  return {
    defaultProvider: manager.getDefaultProvider(),
    defaultModel: manager.getDefaultModel(),
    defaultThinkingLevel: manager.getDefaultThinkingLevel() ?? "off",
    transport: manager.getTransport() ?? "auto",
    compactionEnabled: compaction?.enabled !== false,
    steeringMode: manager.getSteeringMode(),
    followUpMode: manager.getFollowUpMode(),
  };
}

export async function updatePiSettings(
  manager: PiSettingsManager,
  runtime: PiSettingsRuntime,
  payload: PiSettingsUpdate,
): Promise<PiSettingsSummary> {
  const provider = payload.defaultProvider?.trim();
  const model = payload.defaultModel?.trim();
  if (provider || model) {
    if (!provider || !model) throw new Error("defaultProvider and defaultModel must be updated together");
    if (!runtime.getModel(provider, model)) throw new Error(`Unknown model: ${provider}/${model}`);
    manager.setDefaultModelAndProvider(provider, model);
  }
  if (payload.defaultThinkingLevel !== undefined) {
    const level = payload.defaultThinkingLevel;
    if (!new Set(["off", "minimal", "low", "medium", "high", "xhigh"]).has(level)) throw new Error(`Unsupported default thinking level: ${level}`);
    manager.setDefaultThinkingLevel(level);
  }
  if (payload.transport !== undefined) {
    const transport = payload.transport;
    if (!new Set(["auto", "sse", "websocket"]).has(transport)) throw new Error(`Unsupported transport: ${transport}`);
    manager.setTransport(transport);
  }
  if (payload.compactionEnabled !== undefined) manager.setCompactionEnabled(payload.compactionEnabled);
  if (payload.steeringMode !== undefined) {
    const mode = payload.steeringMode;
    if (!new Set(["all", "one-at-a-time"]).has(mode)) throw new Error(`Unsupported steering mode: ${mode}`);
    manager.setSteeringMode(mode);
  }
  if (payload.followUpMode !== undefined) {
    const mode = payload.followUpMode;
    if (!new Set(["all", "one-at-a-time"]).has(mode)) throw new Error(`Unsupported follow-up mode: ${mode}`);
    manager.setFollowUpMode(mode);
  }
  await manager.flush();
  return summarizePiSettings(manager);
}
