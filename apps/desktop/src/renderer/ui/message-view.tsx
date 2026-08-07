import { memo } from "react";
import { parseSkillInvocation } from "@pideck/domain";
import { copy, type Language } from "@pideck/i18n";
import { Icon } from "@pideck/ui-system";
import type { PreviewImage } from "../types";
import { formatMessageTime, messageErrorText, textFromMessage } from "../message-utils";
import { MarkdownContent } from "./markdown";

function MessageView({ message, language, onPreviewImage, onContextMenuImage }: { message: any; language: Language; onPreviewImage: (image: PreviewImage) => void; onContextMenuImage: (event: React.MouseEvent, image: PreviewImage) => void }) {
  const text = textFromMessage(message);
  const images = Array.isArray(message?.content) ? message.content.filter((part: any) => part?.type === "image" && part.data && part.mimeType) : [];
  const t = copy[language];
  const role = message?.role === "user" ? "user" : message?.role === "toolResult" ? "tool" : "assistant";
  const skillInvocation = role === "user" ? parseSkillInvocation(text) : null;
  const visibleText = skillInvocation ? skillInvocation.userMessage ?? "" : text;
  const errorText = messageErrorText(message);
  if (!visibleText && !skillInvocation && !images.length && !errorText && message?.role !== "toolResult") return null;
  if (role === "tool") {
    const toolName = message?.toolName ?? message?.name ?? t.toolResult;
    const failed = Boolean(message?.isError);
    return <div className={`tool-message ${failed ? "failed" : ""}`}><div className="tool-message-heading"><span className="tool-icon"><Icon name={failed ? "alert" : "terminal"} size={14} /></span><strong>{toolName}</strong><span>{failed ? t.sessionState.failed : t.sessionState.completed}</span></div><pre>{text || t.toolResult}</pre></div>;
  }
  const messageTime = formatMessageTime(message.timestamp, language);
  return <article className={`message ${role === "user" ? "user-message" : "assistant-message"}`} tabIndex={0}><div className="message-bubble"><div className="message-content">{skillInvocation && <div className="message-invocations"><code className="message-invocation">/skill:{skillInvocation.name}</code></div>}{images.length > 0 && <div className="message-images">{images.map((image: any, index: number) => <button type="button" className="image-preview-trigger" key={`${message.id ?? "image"}-${index}`} aria-label={t.imagePreview} onClick={() => onPreviewImage({ src: `data:${image.mimeType};base64,${image.data}`, alt: t.imageAttached })} onContextMenu={(event) => onContextMenuImage(event, { src: `data:${image.mimeType};base64,${image.data}`, alt: t.imageAttached })}><img src={`data:${image.mimeType};base64,${image.data}`} alt={t.imageAttached} /></button>)}</div>}{visibleText && <MarkdownContent text={visibleText} language={language} />}{errorText && <div className="message-error" role="alert"><span className="message-error-heading"><Icon name="alert" size={13} /><strong>{t.assistantResponseFailed}</strong></span><code>{errorText}</code></div>}</div></div>{messageTime && <div className="message-hover-meta"><time dateTime={new Date(message.timestamp).toISOString()}>{messageTime}</time></div>}</article>;
}

const MemoMessageView = memo(MessageView, (previous, next) => previous.message === next.message && previous.language === next.language && previous.onPreviewImage === next.onPreviewImage && previous.onContextMenuImage === next.onContextMenuImage);

export { MessageView, MemoMessageView };
