import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

function fixFile(file) {
  let text = fs.readFileSync(file, "utf8");
  const inAi = file.includes(`${path.sep}ai${path.sep}`) || file.endsWith(`${path.sep}ai${path.sep}types.ts`);
  const inLib = file.includes(`${path.sep}lib${path.sep}`);

  if (inAi) {
    text = text.replace(/from '@\/ai\/([^']+)'/g, "from './$1'");
    text = text.replace(/from '@\/lib\/([^']+)'/g, "from '../lib/$1'");
  } else if (inLib) {
    text = text.replace(/from '@\/lib\/([^']+)'/g, "from './$1'");
    text = text.replace(/from '@\/ai\/([^']+)'/g, "from '../ai/$1'");
  }
  text = text.replace(/from '@\/types\/([^']+)'/g, "from '../ai/types'");

  fs.writeFileSync(file, text);
}

for (const file of walk(root)) {
  if (file.endsWith("fix-imports.mjs")) continue;
  fixFile(file);
}

console.log("Fixed blog-writer imports");
