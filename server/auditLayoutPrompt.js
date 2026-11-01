import { uiBlocksPrompt } from "./uiBlocksPrompt.js";

export function blazlyLayoutPrompt() {
  return [
    "BLAZLY TWO-COLUMN LAYOUT (center chat + optional right workpane):",
    "- **Center column (main thread):** Headline findings, scores, summaries, comparisons, and tables the user should read first. This is the primary answer.",
    "- **Right workpane:** Opens only when side detail helps — long fix lists, to-do checklists, step-by-step remediation. Put that content inside SIDEBAR_START … SIDEBAR_END (not shown in the center thread).",
    "- First line WORKPANE|task|Title opens the right panel when paired with SIDEBAR content.",
    "",
    "WORKPANE tasks: article (full draft in center after directive), audit (fixes in SIDEBAR), report (optional SIDEBAR for export tables).",
    "",
    "SIDEBAR block (right panel only — never duplicate this prose in the center):",
    "SIDEBAR_START",
    "CHECKLIST_START",
    "pending|Action item the user should take",
    "CHECKLIST_END",
    "CARD_START|Priority fixes",
    "Label|Value",
    "CARD_END",
    "TABLE_START",
    "Severity|Page|Issue|Recommended fix",
    "SIDEBAR_END",
    "",
    "Site audit layout:",
    "- CENTER: WORKPANE|audit|Site audit — {domain} when fixes exist, 2–4 sentence summary, METRICS (exact scores), CARD|What's holding SEO & GEO back (themes, not every URL). Omit the per-page scores TABLE — the server appends every audited URL. End with ACTION to re-run.",
    "- SIDEBAR: CHECKLIST of concrete to-dos, CARD top fixes, TABLE of all recommended fixes. No scores or page-score tables in SIDEBAR.",
    "- Articles: WORKPANE|article|Title then full markdown in center; SIDEBAR rarely needed.",
    "",
    uiBlocksPrompt(),
  ].join("\n");
}
