import type { ContextUsage } from "@pideck/contracts";
import { copy, type Language } from "@pideck/i18n";

function formatTokenCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function ContextRing({ usage, language }: { usage?: ContextUsage; language: Language }) {
  const t = copy[language];
  const percent = usage?.percent === null || usage?.percent === undefined ? 0 : Math.max(0, Math.min(100, usage.percent));
  const circumference = 2 * Math.PI * 8;
  const dash = circumference * percent / 100;
  return <span className="context-ring-wrap" tabIndex={0} aria-label={t.contextUsage}>
    <span className="context-ring"><svg viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-progress" cx="10" cy="10" r="8" strokeDasharray={`${dash} ${circumference - dash}`} /></svg><span>{usage?.percent === null || usage?.percent === undefined ? "—" : `${Math.round(percent)}%`}</span></span>
    <span className="context-tooltip" role="tooltip"><strong>{t.contextUsage}</strong><span className="context-total">{formatTokenCount(usage?.tokens)} / {formatTokenCount(usage?.contextWindow)} {t.tokenUnit}</span><span>{t.contextUsed}: {formatTokenCount(usage?.tokens)} {t.tokenUnit}</span><span>{t.contextWindow}: {formatTokenCount(usage?.contextWindow)} {t.tokenUnit}</span></span>
  </span>;
}

function ContextRingPopover({ usage, language }: { usage?: ContextUsage; language: Language }) {
  const t = copy[language];
  const percent = usage?.percent === null || usage?.percent === undefined ? 0 : Math.max(0, Math.min(100, usage.percent));
  const circumference = 2 * Math.PI * 8;
  const dash = circumference * percent / 100;
  const percentLabel = usage?.percent === null || usage?.percent === undefined ? t.contextUnknown : `${Math.round(percent)}% ${t.contextUsed}`;
  const totalLabel = usage?.tokens === null || usage?.tokens === undefined || usage?.contextWindow === null || usage?.contextWindow === undefined
    ? t.contextUnknown
    : `${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)} ${t.tokenUnit}`;
  return <span className="context-ring-wrap" tabIndex={0} aria-label={usage?.percent === null || usage?.percent === undefined ? t.contextUsage : `${t.contextUsage}, ${Math.round(percent)}%`}>
    <span className="context-ring"><svg viewBox="0 0 20 20" aria-hidden="true"><circle className="context-ring-track" cx="10" cy="10" r="8" /><circle className="context-ring-progress" cx="10" cy="10" r="8" strokeDasharray={`${dash} ${circumference - dash}`} /></svg></span>
    <span className="context-tooltip" role="tooltip"><strong>{t.contextWindow}</strong><span className="context-percentage">{percentLabel}</span><span className="context-total">{totalLabel}</span></span>
  </span>;
}

export { ContextRing, ContextRingPopover };
