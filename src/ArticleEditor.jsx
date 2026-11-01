import { useEffect, useRef, useState } from "react";
import { htmlToPlainMarkdown, isHtmlArticle, markdownToHtml, sanitizeArticleHtml } from "./articleFormat.js";
import { EditorToolIcon } from "./EditorToolbarIcons.jsx";

const TOOLBAR = [
  { id: "undo", label: "Undo", action: "undo", group: "history" },
  { id: "redo", label: "Redo", action: "redo", group: "history" },
  { id: "sep1", type: "sep" },
  { id: "bold", label: "Bold", command: "bold", group: "style" },
  { id: "italic", label: "Italic", command: "italic", group: "style" },
  { id: "underline", label: "Underline", command: "underline", group: "style" },
  { id: "strike", label: "Strikethrough", command: "strikeThrough", group: "style" },
  { id: "sep2", type: "sep" },
  { id: "h1", label: "Heading 1", block: "h1", group: "block" },
  { id: "h2", label: "Heading 2", block: "h2", group: "block" },
  { id: "h3", label: "Heading 3", block: "h3", group: "block" },
  { id: "p", label: "Normal text", block: "p", group: "block" },
  { id: "sep3", type: "sep" },
  { id: "ul", label: "Bullet list", command: "insertUnorderedList", group: "list" },
  { id: "ol", label: "Numbered list", command: "insertOrderedList", group: "list" },
  { id: "quote", label: "Quote", block: "blockquote", group: "list" },
  { id: "sep4", type: "sep" },
  { id: "link", label: "Insert link", action: "link", group: "insert" },
  { id: "sep5", type: "sep" },
  { id: "left", label: "Align left", align: "left", group: "align" },
  { id: "center", label: "Align center", align: "center", group: "align" },
  { id: "right", label: "Align right", align: "right", group: "align" },
  { id: "sep6", type: "sep" },
  { id: "clear", label: "Clear formatting", command: "removeFormat", group: "clear" },
];

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "DIV"]);

function normalizeTextAlign(value) {
  const align = String(value || "").toLowerCase();
  if (align === "start") return "left";
  if (align === "end") return "right";
  if (align === "left" || align === "right" || align === "center" || align === "justify") return align;
  return "left";
}

function readBlockTextAlign(element) {
  if (!element) return "left";
  if (element.style?.textAlign) return normalizeTextAlign(element.style.textAlign);
  const legacy = element.getAttribute("align");
  if (legacy) return normalizeTextAlign(legacy);
  return normalizeTextAlign(getComputedStyle(element).textAlign);
}

function applyBlockTextAlign(element, align) {
  if (!element) return;
  element.removeAttribute("align");
  element.style.textAlign = normalizeTextAlign(align);
}

export function ArticleEditor({ title, initialContent, onSave, onClose }) {
  const surfaceRef = useRef(null);
  const savedRangeRef = useRef(null);
  const historyRef = useRef({ past: [], future: [], skipPush: false });
  const [wordCount, setWordCount] = useState(0);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    document.body.classList.add("is-article-editor");
    return () => document.body.classList.remove("is-article-editor");
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const html = isHtmlArticle(initialContent) ? initialContent : markdownToHtml(initialContent);
    const safe = sanitizeArticleHtml(html);
    surface.innerHTML = safe || "<p><br></p>";
    seedHistory(safe || "<p><br></p>");
    updateWordCount(surface);
    surface.focus();
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
      document.execCommand("styleWithCSS", false, true);
    } catch {
      // execCommand may be unavailable in some environments.
    }
  }, [initialContent]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    surface.addEventListener("mouseup", saveSelection);
    surface.addEventListener("keyup", saveSelection);
    return () => {
      surface.removeEventListener("mouseup", saveSelection);
      surface.removeEventListener("keyup", saveSelection);
    };
  }, []);

  function seedHistory(html) {
    historyRef.current = { past: [html], future: [], skipPush: false };
    setHistoryTick((value) => value + 1);
  }

  function saveSelection() {
    const surface = surfaceRef.current;
    const selection = window.getSelection();
    if (!surface || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return;
    savedRangeRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const range = savedRangeRef.current;
    const selection = window.getSelection();
    if (!range || !selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function focusSurface() {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.focus({ preventScroll: true });
    restoreSelection();
  }

  function updateWordCount(surface) {
    const text = surface.innerText.replace(/\s+/g, " ").trim();
    setWordCount(text ? text.split(" ").length : 0);
  }

  function pushHistory() {
    const surface = surfaceRef.current;
    const history = historyRef.current;
    if (!surface || history.skipPush) return;
    const html = surface.innerHTML;
    const past = history.past;
    if (past[past.length - 1] === html) return;
    past.push(html);
    if (past.length > 80) past.shift();
    history.future = [];
    setHistoryTick((value) => value + 1);
  }

  function applyHistory(html) {
    const surface = surfaceRef.current;
    if (!surface) return;
    historyRef.current.skipPush = true;
    surface.innerHTML = html;
    historyRef.current.skipPush = false;
    savedRangeRef.current = null;
    updateWordCount(surface);
    setHistoryTick((value) => value + 1);
  }

  function undo() {
    const history = historyRef.current;
    if (history.past.length <= 1) return;
    const current = history.past.pop();
    history.future.push(current);
    applyHistory(history.past[history.past.length - 1]);
    focusSurface();
  }

  function redo() {
    const history = historyRef.current;
    if (!history.future.length) return;
    const next = history.future.pop();
    history.past.push(next);
    applyHistory(next);
    focusSurface();
  }

  function canUndo() {
    return historyRef.current.past.length > 1;
  }

  function canRedo() {
    return historyRef.current.future.length > 0;
  }

  function runCommand(command, value) {
    focusSurface();
    document.execCommand(command, false, value ?? undefined);
    pushHistory();
    updateWordCount(surfaceRef.current);
  }

  function formatBlock(tag) {
    focusSurface();
    const block = blockFromSelection();
    const savedAlign = readBlockTextAlign(block);
    const blockTag = tag === "p" ? "p" : tag;
    document.execCommand("formatBlock", false, `<${blockTag}>`);
    applyBlockTextAlign(blockFromSelection(), savedAlign);
    pushHistory();
    updateWordCount(surfaceRef.current);
  }

  function blockFromSelection() {
    const surface = surfaceRef.current;
    const selection = window.getSelection();
    if (!surface || !selection?.rangeCount) return null;
    let node = selection.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== surface) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function setAlignment(align) {
    focusSurface();
    const block = blockFromSelection();
    if (block) {
      block.style.textAlign = align;
      pushHistory();
      updateWordCount(surfaceRef.current);
      return;
    }
    document.execCommand("styleWithCSS", false, true);
    const command = align === "center" ? "justifyCenter" : align === "right" ? "justifyRight" : "justifyLeft";
    document.execCommand(command, false, undefined);
    pushHistory();
    updateWordCount(surfaceRef.current);
  }

  function insertLink() {
    const url = window.prompt("Link URL");
    if (!url) return;
    runCommand("createLink", url);
  }

  function handleToolbar(item) {
    if (item.type === "sep") return;
    if (item.action === "undo") return undo();
    if (item.action === "redo") return redo();
    if (item.action === "link") return insertLink();
    if (item.align) return setAlignment(item.align);
    if (item.block) return formatBlock(item.block);
    if (item.command) return runCommand(item.command);
  }

  function onToolbarPointerDown(event) {
    saveSelection();
    event.preventDefault();
  }

  function save() {
    const html = sanitizeArticleHtml(surfaceRef.current?.innerHTML || "");
    const markdown = htmlToPlainMarkdown(html);
    onSave?.({ html, markdown });
  }

  return (
    <div className="article-editor-overlay" role="dialog" aria-modal="true" aria-label="Article editor">
      <header className="article-editor-topbar">
        <div className="article-editor-topbar-left">
          <button type="button" className="article-editor-icon-btn" onClick={onClose} aria-label="Close editor">
            ×
          </button>
          <div>
            <p className="article-editor-doc-title">{title || "Untitled document"}</p>
            <p className="article-editor-doc-meta">{wordCount} words</p>
          </div>
        </div>
        <div className="article-editor-topbar-right">
          <button type="button" className="article-editor-btn is-muted" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="article-editor-btn is-primary" onClick={save}>
            Save
          </button>
        </div>
      </header>

      <div className="article-editor-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR.map((item) =>
          item.type === "sep" ? (
            <span key={item.id} className="article-editor-sep" aria-hidden="true" />
          ) : (
            <button
              key={item.id}
              type="button"
              className="article-editor-tool"
              aria-label={item.label}
              disabled={
                historyTick >= 0 &&
                ((item.action === "undo" && !canUndo()) || (item.action === "redo" && !canRedo()))
              }
              onPointerDown={onToolbarPointerDown}
              onClick={() => handleToolbar(item)}
            >
              <EditorToolIcon id={item.id} />
              <span className="article-editor-tooltip" role="tooltip">
                {item.label}
              </span>
            </button>
          )
        )}
      </div>

      <div className="article-editor-scroll">
        <div className="article-editor-page">
          <div
            ref={surfaceRef}
            className="article-editor-surface"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            onInput={(event) => {
              pushHistory();
              updateWordCount(event.currentTarget);
            }}
          />
        </div>
      </div>
    </div>
  );
}
