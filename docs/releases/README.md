# HeartPy Streaming Releases

This index lists HeartPy Streaming release notes. The source of truth for each release is the per‑version notes file under this folder.

## Latest

- [vX.Y.Z](release-notes-$VER.md) (YYYY‑MM‑DD)
  - vDSP/NEON guarded PSD precompute (scalar fallbacks preserved)
  - Optional ring buffer (default OFF) with non‑blocking CI telemetry
  - CI gates intact: 180 s ring‑OFF strict; 60 s smoke relaxed HR
  - Compact JSON mode (`--compact-json`) and build provenance in CI

## All Releases (newest first)

- vX.Y.Z — release-notes-$VER.md
  
Add newer versions above this line as you cut releases, linking to their `release-notes-<version>.md` files.

## How To Cut A Release

1) Pick a version and tag it

```
export VER=vX.Y.Z

git tag -a "$VER" -m "HeartPy streaming: accel paths + ring option"
git push origin "$VER"
```

2) Publish GitHub Release (notes file in this folder)

```
# Replace <version> with $VER; keep the path to the notes file
gh release create "$VER" --title "HeartPy Streaming $VER" --notes-file docs/releases/release-notes-$VER.md
```

## Gates & Provenance (CI)

- Blocking gate: 180 s ring‑OFF acceptance (torch/ambient) — strict
- 60 s smoke: HR relaxed; metrics tracked (non‑blocking)
- Ring‑ON: 60/180 s runs are non‑blocking; deltas + summaries printed with warn‑only guardrails
- Build provenance printed in logs (short SHA + CMake flags); artifacts retained 21 days

---

Optional helpers (nice‑to‑have):
- Template for new releases: `docs/releases/RELEASE_NOTES_TEMPLATE.md`
- A small script can scan `docs/releases/release-notes-*.md` and regenerate this index automatically if desired
