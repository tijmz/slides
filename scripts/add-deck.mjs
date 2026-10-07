#!/usr/bin/env node
// Add (or update) a Slides Extended export in this repo, sharing reveal.js assets.
//
//   node scripts/add-deck.mjs <export-folder> [--name slug] [--title "Title"]
//   node scripts/add-deck.mjs --index        (only regenerate index.html)
//
// Layout produced:
//   decks/<slug>/              index.html, css/, images  (deck-specific)
//   decks/_shared/<hash>/      dist/ + plugin/           (shared, content-addressed)
//
// Exports with identical dist/ + plugin/ share one folder; a changed plugin or
// theme creates a new <hash> folder, so old decks keep the version they were
// exported with and never break.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const decksDir = path.join(root, 'decks');
const sharedDir = path.join(decksDir, '_shared');
const SHARED_PARTS = ['dist', 'plugin'];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p)); // statSync follows symlinks
    else out.push(p);
  }
  return out.sort();
}

function hashParts(exportDir) {
  const h = createHash('sha256');
  for (const part of SHARED_PARTS) {
    const base = path.join(exportDir, part);
    if (!fs.existsSync(base)) throw new Error(`Export has no ${part}/ folder`);
    for (const f of walk(base)) {
      h.update(path.relative(exportDir, f).split(path.sep).join('/') + '\0');
      h.update(fs.readFileSync(f));
    }
  }
  return h.digest('hex').slice(0, 12);
}

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');

const escHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function readMeta(deckPath) {
  const f = path.join(deckPath, 'deck.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}

function addDeck(exportDir, opts) {
  if (!fs.existsSync(path.join(exportDir, 'index.html'))) {
    throw new Error(`${exportDir} has no index.html - is this a Slides Extended export?`);
  }
  const slug = opts.name ?? slugify(path.basename(exportDir));
  const deckPath = path.join(decksDir, slug);
  const hash = hashParts(exportDir);

  // 1. shared assets (skipped when this exact version already exists)
  const target = path.join(sharedDir, hash);
  let newShared = false;
  if (!fs.existsSync(target)) {
    for (const part of SHARED_PARTS) {
      fs.cpSync(path.join(exportDir, part), path.join(target, part), { recursive: true, dereference: true });
    }
    newShared = true;
  }

  // 2. deck-specific files (everything except the shared parts)
  const prevMeta = readMeta(deckPath);
  fs.rmSync(deckPath, { recursive: true, force: true });
  fs.cpSync(exportDir, deckPath, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = path.relative(exportDir, src).split(path.sep)[0];
      return !SHARED_PARTS.includes(rel);
    },
  });

  // 3. rewrite shared paths (read/write as latin1 so every byte round-trips unchanged)
  const htmlPath = path.join(deckPath, 'index.html');
  const original = fs.readFileSync(htmlPath, 'latin1');
  const re = /(["'])(dist|plugin)\//g;
  const rewritten = original.replace(re, `$1../_shared/${hash}/$2/`);
  const count = (original.match(re) ?? []).length;
  fs.writeFileSync(htmlPath, rewritten, 'latin1');

  // 4. sanity: every rewritten reference must exist
  const missing = [];
  for (const m of rewritten.matchAll(/["']\.\.\/_shared\/[0-9a-f]+\/((?:dist|plugin)\/[^"'?#]+)/g)) {
    if (!fs.existsSync(path.join(target, m[1]))) missing.push(m[1]);
  }

  // 5. metadata
  const htmlTitle = original.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  const meta = {
    title: opts.title ?? prevMeta.title ?? (htmlTitle || path.basename(exportDir)),
    added: prevMeta.added ?? new Date().toISOString().slice(0, 10),
    shared: hash,
  };
  fs.writeFileSync(path.join(deckPath, 'deck.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log(`deck      ${slug}  ("${meta.title}")`);
  console.log(`shared    ${hash}  ${newShared ? 'NEW copy' : 'reused existing'}`);
  console.log(`rewrote   ${count} path references`);
  if (missing.length) console.warn(`WARNING   missing in shared: ${[...new Set(missing)].join(', ')}`);
}

function pruneShared() {
  if (!fs.existsSync(sharedDir)) return;
  const used = new Set();
  for (const d of fs.readdirSync(decksDir, { withFileTypes: true })) {
    if (d.isDirectory() && d.name !== '_shared') used.add(readMeta(path.join(decksDir, d.name)).shared);
  }
  for (const h of fs.readdirSync(sharedDir)) {
    if (!used.has(h)) {
      fs.rmSync(path.join(sharedDir, h), { recursive: true, force: true });
      console.log(`pruned    unused shared/${h}`);
    }
  }
}

function writeIndex() {
  const decks = fs
    .readdirSync(decksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared' && fs.existsSync(path.join(decksDir, d.name, 'index.html')))
    .map((d) => ({ slug: d.name, ...readMeta(path.join(decksDir, d.name)) }))
    .map((d) => ({ ...d, title: d.title || d.slug, added: d.added || '' }))
    .sort((a, b) => b.added.localeCompare(a.added) || a.title.localeCompare(b.title));

  const items = decks
    .map(
      (d) =>
        `      <li><a href="decks/${encodeURIComponent(d.slug)}/"><span>${escHtml(d.title)}</span><time>${escHtml(d.added)}</time></a></li>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Slides</title>
  <style>
    :root { --bg:#fff; --fg:#1d1d1f; --muted:#6b6b72; --line:#e3e3e8; --accent:#2a5bd7; }
    @media (prefers-color-scheme: dark) { :root { --bg:#121214; --fg:#ececf0; --muted:#9a9aa3; --line:#2b2b31; --accent:#7ea2ff; } }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
    main { max-width:42rem; margin:0 auto; padding:3rem 16px; }
    h1 { font-size:1.75rem; margin:0 0 1.5rem; }
    ul { list-style:none; margin:0; padding:0; border-top:1px solid var(--line); }
    li { border-bottom:1px solid var(--line); }
    a { display:flex; justify-content:space-between; gap:1rem; padding:.9rem 0; color:var(--fg); text-decoration:none; }
    a:hover span { color:var(--accent); }
    time { color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; }
  </style>
</head>
<body>
  <main>
    <h1>Slides</h1>
    <ul>
${items}
    </ul>
  </main>
</body>
</html>
`;
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log(`index     ${decks.length} deck(s) listed`);
}

// --- main ---
const args = process.argv.slice(2);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const name = opt('--name');
const title = opt('--title');
const indexOnly = args.includes('--index');
const exportDir = args.find((a) => !a.startsWith('--'));

fs.mkdirSync(decksDir, { recursive: true });
if (!indexOnly) {
  if (!exportDir) {
    console.error('usage: node scripts/add-deck.mjs <export-folder> [--name slug] [--title "Title"]');
    process.exit(1);
  }
  addDeck(path.resolve(exportDir), { name, title });
  pruneShared();
}
writeIndex();
