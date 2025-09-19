# HeartPy Streaming $VER — Release Notes

## Highlights

- vDSP/NEON guarded PSD precompute paths (scalar fallbacks preserved)
- Optional ring buffer (default OFF): fixed‑capacity window + snapshot path
- CI gates intact: 180 s ring‑OFF strict; 60 s smoke (relaxed HR)
- Non‑blocking ring‑ON telemetry (60/180): deltas + summaries + guardrail warnings
- Build provenance in CI: short SHA + CMake flags; artifacts retained 21 days
- Compact JSON mode (`--compact-json`) to reduce artifact size when needed

## Assurance

- Acceptance 180 s (torch/ambient, ring‑OFF): PASS
- Accel vs ref (macOS): deltas 0.00 across bpm/snr/conf/f0
- Concurrency smoke: stable
- Sanitizers (ASAN/UBSAN/TSAN): green

## Telemetry (CI)

- Ring‑ON runs (non‑blocking):
  - 60 s: medians after warm‑up (no PASS/FAIL)
  - 180 s: full acceptance checks; PASS/FAIL printed (non‑fatal)
- Delta summary (ring‑ON vs ring‑OFF):
  - |Δbpm_med|, |Δsnr_med|, |Δconf_med|, |Δf0_used_hz_med|
  - |Δma_share| and |Δhard_frac|
  - Δ medians for `min_rr_ms` and `ref_ms`
- Guardrails (warn‑only, do not fail CI):
  - |Δma_share| > 0.02
  - |Δhard_frac| increase > 0.02
  - |Δmin_rr_ms| > 20 ms
  - |Δref_ms| > 15 ms
- Artifacts (21 days): acceptance JSONLs (OFF/ON), PSD and poll‑latency bench logs

## How To Enable

- Acceleration (platform‑dependent):
  - `-DHEARTPY_ENABLE_ACCELERATE=ON` (Apple); FFT via Accelerate; PSD precompute via vDSP when enabled
  - `-DHEARTPY_ENABLE_NEON=ON` (ARM); PSD precompute NEON path (KissFFT branch)
- Ring buffer: `Options.useRingBuffer=true` or demo `--use-ring 1` (non‑blocking telemetry in CI)
- Compact JSON (demo): `--compact-json` (emits only acceptance‑critical fields)

## Known / Scope

- ARM/NEON CI validation is queued for an ARM runner/device; remains non‑blocking initially
- Ring‑ON remains telemetry‑only; ring‑OFF 180 s acceptance is the release gate
- 60 s smoke HR check relaxed by design

## Post‑Release Monitoring

- Watch ring‑ON guardrails in CI logs (warn‑only)
- Validate acceptance medians (bpm≈72±2; snr≥6 dB; conf≥0.6; rej≤0.1; ma_share≥0.6; hard_frac≤0.05)
- Concurrency smoke continues to run; artifacts retained for 21 days

## Next (High Priority)

- Add ARM job (NEON+KissFFT, non‑blocking); validate deltas within tolerances; consider gating later
- Keep ring‑ON A/B telemetry; promote to gate only if long‑run stability confirmed

---

Publish with GitHub CLI:

```
gh release create "$VER" --title "HeartPy Streaming $VER" --notes-file docs/releases/release-notes-$VER.md
```

