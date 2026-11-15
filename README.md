# Rands – iPhone expense tracker (no Mac needed)

A Home Screen web app: offline, data stays on your phone.

## Install on your iPhone (GitHub Pages, free)
1. On github.com create a **public** repo called `rands`.
2. Add file → Upload files → upload everything in this folder (index.html, manifest.json, sw.js, the 3 icons). Commit.
3. Repo Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
4. After ~1 minute open `https://<your-username>.github.io/rands/` in **Safari**.
5. Share → **Add to Home Screen** → Add. Launch it from the icon.

## Notes
- Data lives in the Home Screen app's own storage. Use Settings → *Back up data (JSON)* now and then (save to Files/iCloud).
- Updating: edit files, push, and bump `CACHE` in sw.js (e.g. rands-v2).
- Local testing on a computer: `python3 -m http.server 8000` in this folder, open http://localhost:8000.
