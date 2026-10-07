# Slides

Slides Extended (Obsidian) exports, published with GitHub Pages.

## Layout

```
index.html                  generated list of decks
decks/<slug>/               one deck: index.html, css/, images, deck.json
decks/_shared/<hash>/       one shared copy of reveal.js (dist/) and plugins (plugin/)
decks/_shared/CURRENT       the shared version new decks are linked to
scripts/add-deck.mjs        adds a deck, rewrites paths, builds the index, checks the repo
incoming/                   drop exports here; the workflow processes them
```

Decks never contain their own `dist/` or `plugin/`; their `index.html` points at
`../_shared/<hash>/...`. A deck keeps the shared version it was linked to, so
upgrading plugins later never breaks old decks.

## Adding a deck

**Via GitHub (no local tools):** put the export in `incoming/<Deck name>/` and push or
upload. The `Process exports` workflow moves it to `decks/`, fixes the paths,
regenerates the index, verifies all references and commits the result.

- Only `index.html`, `css/` and the images are needed (roughly 100-400 KB). Leave out
  `dist/` and `plugin/`; the deck is linked to the current shared version.
- Optional: include a `deck.json` with `{"title": "My title"}` for the title shown
  in the index. Otherwise the folder name is used.
- After the Slides Extended plugin updates, add one deck with its full export
  (including `dist/` and `plugin/`) so the new version becomes the current one.

**Locally:**

```
node scripts/add-deck.mjs "<export folder>" --name <slug> --title "<Title>"
node scripts/add-deck.mjs --index     # only regenerate index.html
node scripts/add-deck.mjs --check     # verify structure and references
```

Hard-reload (Ctrl+F5) after publishing to bypass cached copies.
