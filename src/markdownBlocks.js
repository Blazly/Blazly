function parseCells(line) {
  let row = String(line || "").trim();
  if (!row.includes("|")) return [];
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  const cells = parseCells(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function isTableRow(line) {
  const cells = parseCells(line);
  return cells.length >= 2;
}

function readMarkdownTable(lines, start) {
  const headers = parseCells(lines[start]);
  let index = start + 1;
  const rows = [];

  if (lines[index] && isSeparatorRow(lines[index])) {
    index += 1;
  }

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || !isTableRow(line) || isSeparatorRow(line)) break;
    rows.push(parseCells(line));
    index += 1;
  }

  return { headers, rows, next: index };
}

function parseParagraphChunk(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const splitSection = line.match(/^(\d+\.\s+\*\*.+?\*\*)\s+(.+)$/);
    if (splitSection) {
      blocks.push({ type: "heading", text: splitSection[1].trim(), level: 2 });
      blocks.push({ type: "paragraph", text: splitSection[2].trim() });
      continue;
    }
    if (isSectionHeadingLine(line, lines[lineIndex + 1])) {
      blocks.push({ type: "heading", text: normalizeHeadingLine(line), level: headingLevelFromLine(line) });
      continue;
    }
    if (isListLine(line)) {
      blocks.push({
        type: "list",
        items: [line.replace(/^[-•*]\s+|^\d+\.\s+/, "")],
      });
      continue;
    }
    if (isHeadingLine(line)) {
      blocks.push({ type: "heading", text: normalizeHeadingLine(line), level: headingLevelFromLine(line) });
      continue;
    }
    blocks.push({ type: "paragraph", text: line });
  }

  return blocks;
}

function isListLine(line) {
  return /^[-•*]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

function isSectionHeadingLine(line, nextLine) {
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\d+\.\s+\*\*.+\*\*\s*$/.test(line)) return true;
  if (/^\*\*\d+\.\s+.+\*\*\s*$/.test(line)) return true;
  if (/^\d+\.\s+[A-Za-z0-9]/.test(line)) {
    const title = line.replace(/^\d+\.\s+/, "").trim();
    const compact = title.length <= 64 && !/[.!?]\s+\w/.test(title);
    const followedByBody = nextLine && !/^\d+\.\s+/.test(nextLine) && !/^#{1,6}\s+/.test(nextLine);
    if (compact && followedByBody) return true;
  }
  return false;
}

function isHeadingLine(line) {
  return /^\*\*.+\*\*:?\s*$/.test(line) || (/^\*\*.+\*\*/.test(line) && line.length < 120);
}

function headingLevelFromLine(line) {
  const match = String(line || "").match(/^(#{1,6})\s+/);
  if (match) return Math.min(6, match[1].length);
  return 2;
}

function normalizeHeadingLine(line) {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

export function buildMarkdownBlocks(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const rawLines = normalized.split("\n");
  const blocks = [];
  let paragraphBuffer = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push(...parseParagraphChunk(paragraphBuffer.join("\n")));
    paragraphBuffer = [];
  };

  while (index < rawLines.length) {
    const line = rawLines[index].trim();

    if (!line) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (isTableRow(line)) {
      const nextLine = rawLines[index + 1]?.trim() || "";
      const hasSeparator = isSeparatorRow(nextLine);
      const rowCount = (() => {
        let count = 0;
        let cursor = index;
        while (cursor < rawLines.length) {
          const candidate = rawLines[cursor]?.trim();
          if (!candidate) break;
          if (!isTableRow(candidate)) break;
          if (cursor !== index && isSeparatorRow(candidate)) {
            cursor += 1;
            continue;
          }
          count += 1;
          cursor += 1;
        }
        return count;
      })();

      if (hasSeparator || rowCount >= 2) {
        flushParagraph();
        const table = readMarkdownTable(rawLines, index);
        if (table.headers.length) {
          blocks.push({ type: "table", headers: table.headers, rows: table.rows });
        }
        index = table.next;
        continue;
      }
    }

    paragraphBuffer.push(rawLines[index]);
    index += 1;
  }

  flushParagraph();
  return blocks;
}
