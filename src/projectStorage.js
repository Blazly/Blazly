const PROJECTS_KEY = "blazly-projects";

export function newProjectId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function projectFromProfile(profile) {
  if (!profile?.project) return null;
  return {
    id: slugProjectId(profile.project),
    name: profile.project,
    website: profile.website || profile.knowledge?.website || "",
    knowledge: profile.knowledge || null,
  };
}

export function defaultProjects(profile) {
  const fromProfile = projectFromProfile(profile);
  if (fromProfile) return [fromProfile];
  return [
    {
      id: "default",
      name: "My project",
      website: "",
      knowledge: null,
    },
  ];
}

function slugProjectId(name) {
  const base = String(name || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || newProjectId();
}

function normalizeProject(entry, profile) {
  if (entry && typeof entry === "object" && entry.name) {
    return {
      id: entry.id || slugProjectId(entry.name),
      name: String(entry.name).trim(),
      website: entry.website || "",
      knowledge: entry.knowledge || null,
      logo: entry.logo || "",
      ...(entry.shareId ? { shareId: entry.shareId } : {}),
    };
  }
  if (typeof entry === "string" && entry.trim()) {
    const name = entry.trim();
    const fromProfile = profile?.project === name ? projectFromProfile(profile) : null;
    return (
      fromProfile || {
        id: slugProjectId(name),
        name,
        website: "",
        knowledge: null,
      }
    );
  }
  return null;
}

export function loadProjects(uid, profile) {
  if (!uid) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(`${PROJECTS_KEY}-${uid}`) || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.map((item) => normalizeProject(item, profile)).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveProjects(uid, projects) {
  if (!uid) return;
  try {
    // Projects shared with you by a teammate come from the server and are never stored as your own.
    const list = projects
      .filter((item) => !item?.shared)
      .map((item) => normalizeProject(item))
      .filter(Boolean)
      .filter((item, index, all) => all.findIndex((other) => other.name === item.name) === index);
    localStorage.setItem(`${PROJECTS_KEY}-${uid}`, JSON.stringify(list));
  } catch {
    // Ignore storage failures.
  }
}

export function projectDisplayWebsite(project) {
  if (!project) return "";
  return project.website || project.knowledge?.website || "";
}

/** @deprecated use defaultProjects */
export function defaultProjectNames(profileProject) {
  return defaultProjects(profileProject ? { project: profileProject } : null).map((item) => item.name);
}
