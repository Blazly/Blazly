const LOGO_SRC = "/assets/logo.png";

/** Product logo. `size` sets the rendered mark size in px. */
export function BrandLogo({ className = "", size = 32, withText = false }) {
  return (
    <div className={`brand-lockup ${className}`.trim()}>
      <img
        className="brand-logo"
        src={LOGO_SRC}
        alt={withText ? "" : "Blazly"}
        width={size}
        height={size}
        decoding="async"
      />
      {withText ? <span className="brand-name">Blazly</span> : null}
    </div>
  );
}
