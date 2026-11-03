import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";
import { ATTACHMENT_ACCEPT, attachmentKey, formatFileSize } from "./chatAttachments.js";

export const COMPOSER_EFFORT_TIERS = [
  { id: "low", label: "Low", description: "For quick responses and simple tasks." },
  { id: "medium", label: "Medium", description: "Routine daily work." },
  { id: "high", label: "High", description: "Good for agentic work and analysis." },
  { id: "extraHigh", label: "Extra High", description: "Complex advanced work." },
  { id: "max", label: "Max", description: "Proactive agentic work." },
];

export function apiModeFromComposer(effortAuto, effortTierId) {
  if (effortAuto) return "Auto";
  const map = {
    low: "Fast",
    medium: "Auto",
    high: "Deep",
    extraHigh: "Deep",
    max: "Deep",
  };
  return map[effortTierId] || "Auto";
}

export function inferComposerFromMode(mode) {
  if (mode === "Fast") return { effortAuto: false, effortTier: "low" };
  if (mode === "Deep") return { effortAuto: false, effortTier: "high" };
  return { effortAuto: false, effortTier: "medium" };
}

export function PromptShell({
  isCompact = false,
  activeAgent,
  onClearAgent,
  reuseAgent,
  onReuseAgent,
  agents,
  onPickAgent,
  prompt,
  promptRef,
  placeholder,
  status,
  attachments,
  onRemoveAttachment,
  fileRef,
  onFiles,
  attachmentAccept,
  onSubmit,
  onPromptChange,
  onPromptKeyDown,
  onPromptPaste,
  effortTier,
  effortTierLocked = false,
  onEffortTierChange,
  onPromptValueChange,
  busy,
}) {
  const [effortOpen, setEffortOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addRootRef = useRef(null);

  useEffect(() => {
    if (!addOpen) return;
    const onDoc = (event) => {
      if (addRootRef.current?.contains(event.target)) return;
      setAddOpen(false);
    };
    const onKey = (event) => event.key === "Escape" && setAddOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [addOpen]);
  const [listening, setListening] = useState(false);
  const effortRootRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceBaseRef = useRef("");
  const speechSupported = useMemo(() => Boolean(getSpeechRecognition()), []);
  const lockedTier = effortTierLocked ? "max" : effortTier;
  const tierMeta = useMemo(
    () => COMPOSER_EFFORT_TIERS.find((t) => t.id === lockedTier) || COMPOSER_EFFORT_TIERS[1],
    [lockedTier],
  );
  const tierIndex = COMPOSER_EFFORT_TIERS.findIndex((t) => t.id === lockedTier);

  useEffect(() => {
    if (!effortOpen) return;
    const onDoc = (event) => {
      if (effortRootRef.current?.contains(event.target)) return;
      setEffortOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [effortOpen]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  function stopListening() {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  }

  useEffect(() => {
    if (busy) stopListening();
  }, [busy]);

  function toggleVoiceInput() {
    if (!speechSupported || !onPromptValueChange) return;
    if (listening) {
      stopListening();
      return;
    }

    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    voiceBaseRef.current = prompt;
    let finalTranscript = "";

    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        onPromptValueChange?.(voiceBaseRef.current + finalTranscript);
      }
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalTranscript += chunk;
        else interim += chunk;
      }
      const base = voiceBaseRef.current;
      const spoken = (finalTranscript + interim).trim();
      if (!spoken) {
        onPromptValueChange(base);
        return;
      }
      const needsSpace = base.length > 0 && !/\s$/.test(base);
      onPromptValueChange(`${base}${needsSpace ? " " : ""}${spoken}`);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
    }
  }

  const hasContent = Boolean(String(prompt || "").trim()) || attachments.length > 0;

  return (
    <div className={`composer-wrap${isCompact ? " is-compact" : ""}`}>
      <form
        className={`composer${activeAgent ? " has-agent" : ""}`}
        style={activeAgent?.color ? { "--agent-c": activeAgent.color } : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          ref={fileRef}
          className="file-input"
          type="file"
          accept={attachmentAccept || ATTACHMENT_ACCEPT}
          multiple
          onChange={(event) => {
            onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {activeAgent ? (
          <PromptAgentChip agent={activeAgent} onClear={onClearAgent} />
        ) : reuseAgent ? (
          <button type="button" className="composer-agent-reuse" onClick={() => onReuseAgent(reuseAgent)}>
            <Icon name={reuseAgent.icon} size={14} />
            Use {reuseAgent.title} again
          </button>
        ) : null}
        {status && (
          <p className="composer-status" role="status">
            <Icon name="info" size={15} />
            <span>{status}</span>
          </p>
        )}
        <PromptAttachments files={attachments} onRemove={onRemoveAttachment} />
        <textarea
          ref={promptRef}
          className="composer-input"
          rows={1}
          value={prompt}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={onPromptChange}
          onKeyDown={onPromptKeyDown}
          onPaste={onPromptPaste}
        />
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            <div className="composer-add" ref={addRootRef}>
              <button
                type="button"
                className="composer-icon-btn"
                aria-label={agents?.length ? "Add files or an agent" : "Add attachment"}
                title={agents?.length ? "Upload files or pick an agent" : "Attach files or images"}
                aria-expanded={agents?.length ? addOpen : undefined}
                onClick={() => (agents?.length ? setAddOpen((open) => !open) : fileRef.current?.click())}
              >
                <Icon name="plus" size={18} />
              </button>
              {addOpen && agents?.length ? (
                <div className="composer-add-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="composer-add-item"
                    onClick={() => {
                      setAddOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    <Icon name="paperclip" size={15} />
                    <span>Upload files or images</span>
                  </button>
                  <p className="composer-add-label">Agents</p>
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeAgent?.id === agent.id}
                      className={`composer-add-item${activeAgent?.id === agent.id ? " is-active" : ""}`}
                      onClick={() => {
                        setAddOpen(false);
                        onPickAgent(agent);
                      }}
                    >
                      <Icon name={agent.icon} size={15} />
                      <span>{agent.title}</span>
                      {activeAgent?.id === agent.id ? <Icon name="check" size={14} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="composer-toolbar-end">
            <div className="composer-effort" ref={effortRootRef}>
              <button
                type="button"
                className={`composer-effort-trigger${effortTierLocked ? " is-locked" : ""}`}
                aria-expanded={effortTierLocked ? false : effortOpen}
                aria-haspopup={effortTierLocked ? undefined : "dialog"}
                aria-disabled={effortTierLocked || undefined}
                title={effortTierLocked ? "Agents always run on Max effort" : "Model effort"}
                onClick={() => {
                  if (effortTierLocked) return;
                  setEffortOpen((open) => !open);
                }}
              >
                <Icon name="gauge" size={15} />
                <span className="composer-effort-name">{tierMeta.label}</span>
                {!effortTierLocked ? <ComposerChevron up={effortOpen} /> : null}
              </button>
              {effortOpen && !effortTierLocked && (
                <div className="composer-effort-popover" role="dialog" aria-label="Model effort">
                  <div className="composer-effort-detail">
                    <p className="composer-effort-detail-title">{tierMeta.label}</p>
                    <p className="composer-effort-detail-desc">{tierMeta.description}</p>
                  </div>
                  <ComposerEffortTrack
                    tierIndex={tierIndex >= 0 ? tierIndex : 1}
                    tierId={tierMeta.id}
                    onSelect={(index) => onEffortTierChange(COMPOSER_EFFORT_TIERS[index].id)}
                  />
                  <p className="composer-effort-drag-hint">Drag the slider to choose effort level.</p>
                </div>
              )}
            </div>
            <button
              type="button"
              className={`composer-icon-btn composer-mic-btn${listening ? " is-listening" : ""}`}
              aria-label={listening ? "Stop voice input" : "Voice input"}
              aria-pressed={listening}
              disabled={!speechSupported || busy}
              title={
                speechSupported
                  ? listening
                    ? "Stop dictation"
                    : "Dictate with your microphone"
                  : "Voice input is not supported in this browser"
              }
              onClick={toggleVoiceInput}
            >
              <Icon name="mic" size={17} />
            </button>
            <button
              type="submit"
              className={`composer-send${hasContent ? "" : " is-idle"}`}
              aria-label="Send"
              disabled={busy}
            >
              <Icon name="arrowUp" size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ComposerEffortTrack({ tierIndex, tierId, onSelect }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const isMax = tierId === "max";
  const fillPct = ((tierIndex + 0.5) / COMPOSER_EFFORT_TIERS.length) * 100;

  function indexFromClientX(clientX) {
    const el = trackRef.current;
    if (!el) return tierIndex;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return tierIndex;
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const ratio = x / rect.width;
    const idx = Math.floor(ratio * COMPOSER_EFFORT_TIERS.length);
    return Math.min(COMPOSER_EFFORT_TIERS.length - 1, Math.max(0, idx));
  }

  function pickAt(clientX) {
    onSelect(indexFromClientX(clientX));
  }

  function onPointerDown(event) {
    event.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    trackRef.current?.setPointerCapture?.(event.pointerId);
    pickAt(event.clientX);
  }

  function onPointerMove(event) {
    if (!draggingRef.current) return;
    pickAt(event.clientX);
  }

  function endDrag(event) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (trackRef.current?.hasPointerCapture?.(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={trackRef}
      className={`composer-effort-track${isMax ? " is-max" : ""}${dragging ? " is-dragging" : ""}`}
      data-index={tierIndex}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={COMPOSER_EFFORT_TIERS.length - 1}
      aria-valuenow={tierIndex}
      aria-valuetext={COMPOSER_EFFORT_TIERS[tierIndex]?.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="composer-effort-track-fill" style={{ width: `${fillPct}%` }} />
      <div className="composer-effort-ticks" aria-hidden="true">
        {COMPOSER_EFFORT_TIERS.map((tier, index) => (
          <span
            key={tier.id}
            className={`composer-effort-tick${index === tierIndex ? " is-active" : ""}`}
          >
            {index === tierIndex ? (
              <span className="composer-effort-grip">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <span className="composer-effort-tick-mark" />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function PromptAgentChip({ agent, onClear }) {
  return (
    <div className="composer-agent-pill" role="status" aria-live="polite">
      <span className="composer-agent-pill-icon">
        <Icon name={agent.icon} size={15} />
      </span>
      <span className="composer-agent-pill-text">
        <strong>{agent.title}</strong>
        <span className="composer-agent-pill-meta">{agent.chipHint || agent.body}</span>
      </span>
      <button
        type="button"
        className="composer-agent-pill-clear"
        aria-label={`Remove ${agent.title} agent`}
        title="Remove agent"
        onClick={onClear}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

function PromptAttachments({ files, onRemove }) {
  const previews = useMemo(() => {
    const map = new Map();
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        map.set(attachmentKey(file), URL.createObjectURL(file));
      }
    }
    return map;
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
    };
  }, [previews]);

  if (!files.length) return null;

  return (
    <div className="composer-attachments">
      {files.map((file, index) => {
        const key = attachmentKey(file);
        const preview = previews.get(key);
        return (
          <div key={key} className="composer-attachment">
            {preview ? (
              <img src={preview} alt="" />
            ) : (
              <span className="composer-attachment-name">
                {file.name} · {formatFileSize(file.size)}
              </span>
            )}
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>
              <Icon name="x" size={12} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ComposerChevron({ up }) {
  return (
    <svg
      className={`composer-effort-chevron${up ? " is-up" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
