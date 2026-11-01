import { WORKSPACE_MODES } from "./workspaceMode.js";

export function WorkspaceModeToggle({ mode, onChange, disabled = false }) {
  const isAi = mode === WORKSPACE_MODES.ai;

  return (
    <div
      className={`workspace-mode-toggle${isAi ? " is-ai" : " is-manual"}${disabled ? " is-disabled" : ""}`}
      role="group"
      aria-label="Workspace mode"
    >
      <button
        type="button"
        className={`workspace-mode-option${isAi ? " is-active" : ""}`}
        aria-pressed={isAi}
        disabled={disabled}
        onClick={() => onChange(WORKSPACE_MODES.ai)}
      >
        <span className="workspace-mode-dot" aria-hidden="true" />
        AI mode
      </button>
      <button
        type="button"
        className={`workspace-mode-option${!isAi ? " is-active" : ""}`}
        aria-pressed={!isAi}
        disabled={disabled}
        onClick={() => onChange(WORKSPACE_MODES.manual)}
      >
        <span className="workspace-mode-dot" aria-hidden="true" />
        Manual mode
      </button>
    </div>
  );
}
