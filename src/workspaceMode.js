const STORAGE_KEY = "blazly-workspace-mode";

export const WORKSPACE_MODES = {
  ai: "ai",
  manual: "manual",
};

export function loadWorkspaceMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === WORKSPACE_MODES.ai || value === WORKSPACE_MODES.manual) return value;
  } catch {
    /* ignore */
  }
  return WORKSPACE_MODES.manual;
}

export function saveWorkspaceMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
