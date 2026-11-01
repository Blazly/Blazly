import { Icon } from "./Icon.jsx";
import { THEME_OPTIONS } from "./theme.js";

export function SettingsView({ mode, modes, onModeChange, theme, onThemeChange }) {
  return (
    <div className="page page-narrow">
      <header className="page-intro">
        <div className="page-intro-text">
          <h1>Settings</h1>
          <p className="subpage-lead">How Blazly looks and how it answers by default.</p>
        </div>
      </header>
      <div className="settings">
        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Appearance</h2>
          </div>
          <div className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Theme</span>
              <span className="settings-row-note">System follows your device setting.</span>
            </span>
            <div className="segmented" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.id}
                  className={`segmented-option${theme === option.id ? " is-selected" : ""}`}
                  onClick={() => onThemeChange(option.id)}
                >
                  <Icon name={option.icon} size={15} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <h2 className="settings-section-title">Responses</h2>
          </div>
          <div className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Default mode</span>
              <span className="settings-row-note">Used the next time you send a prompt from Home.</span>
            </span>
            <div className="segmented" role="radiogroup" aria-label="Default mode">
              {modes.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={mode === item}
                  className={`segmented-option${mode === item ? " is-selected" : ""}`}
                  onClick={() => onModeChange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
