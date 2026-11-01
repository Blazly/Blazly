import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const scrapeRoot = path.join(root, "../scrape-lib");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function fixFile(file) {
  let text = fs.readFileSync(file, "utf8");
  const inServer = file.includes(`${path.sep}server${path.sep}`);
  text = text.replace(/from '@\/lib\/scrape\/([^']+)'/g, "from '../../scrape-lib/$1'");
  if (inServer) {
    text = text.replace(/from '@\/lib\/site-audit\/server\/([^']+)'/g, "from './$1'");
    text = text.replace(/from '@\/lib\/site-audit\/([^']+)'/g, "from '../$1'");
  } else if (file.includes(`${path.sep}types${path.sep}`)) {
    text = text.replace(/from '@\/types\/site-audit'/g, "from './site-audit'");
  } else {
    text = text.replace(/from '@\/lib\/site-audit\/([^']+)'/g, "from './$1'");
  }
  text = text.replace(/from '@\/types\/site-audit'/g, "from './types/site-audit'");
  fs.writeFileSync(file, text);
}

for (const file of [...walk(root), ...walk(scrapeRoot)]) {
  if (file.endsWith("fix-imports.mjs")) continue;
  fixFile(file);
}

console.log("Fixed imports in site-audit-lib and scrape-lib");
