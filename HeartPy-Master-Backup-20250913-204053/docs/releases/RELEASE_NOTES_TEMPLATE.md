# HeartPy Streaming <version> — Release Notes

## Highlights

- <Top 3–5 bullets>

## Assurance

- Acceptance 180 s (torch/ambient, ring‑OFF): PASS
- Accel vs ref (platform): deltas within tolerances
- Concurrency smoke: stable
- Sanitizers (ASAN/UBSAN/TSAN): green

## Telemetry (CI)

- Ring‑ON runs (non‑blocking): 60 s medians; 180 s PASS/FAIL + diagnostics
- Delta summary: bpm/snr/conf/f0 medians, ma_share & hard_frac deltas, min_rr_ms & ref_ms medians
- Guardrails (warn‑only): ma_share>0.02, hard_frac>0.02, |Δmin_rr_ms|>20 ms, |Δref_ms|>15 ms
- Artifacts (21 days): acceptance JSONLs, PSD/poll‑latency bench logs

## How To Enable

- Acceleration: `-DHEARTPY_ENABLE_ACCELERATE=ON` (Apple), `-DHEARTPY_ENABLE_NEON=ON` (ARM)
- Ring buffer: `Options.useRingBuffer=true` or `--use-ring 1`
- Compact JSON: `--compact-json`

## Known / Scope

- <Items>

## Post‑Release Monitoring

- <Items>

## Next (High Priority)

- <Items>

---

Publish with GitHub CLI:

```
gh release create "$VER" --title "HeartPy Streaming $VER" --notes-file docs/releases/release-notes-$VER.md
```

