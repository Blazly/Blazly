import { useEffect, useState } from "react";

export async function fetchSiteLogo(website) {
  if (!website) return "";
  try {
    const res = await fetch(`/api/site-logo?${new URLSearchParams({ url: website })}`);
    if (!res.ok) return "";
    const data = await res.json();
    return data.logo || "";
  } catch {
    return "";
  }
}

/** Project logo with a letter fallback when there is no logo or it fails to load. */
export function ProjectAvatar({ name, logo, className = "project-badge" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logo]);
  const letter = String(name || "").trim().charAt(0).toUpperCase() || "P";

  if (logo && !failed) {
    return (
      <span className={`${className} has-logo`}>
        <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className={className}>{letter}</span>;
}
