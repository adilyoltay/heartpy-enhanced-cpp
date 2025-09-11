# 📱 HeartPy Enhanced — Mobile Quickstart

This guide shows how to integrate and use HeartPy Enhanced on mobile devices (iOS/Android), with React Native as the primary interface. It also includes performance tips, validation steps, and troubleshooting.

---

## 1) Requirements

- iOS: Xcode 14+, iOS 12+; CocoaPods installed
- Android: Android Studio Flamingo+, NDK (r25c+) recommended, CMake 3.15+
- Node 16+ (React Native), Yarn or NPM
- C++17 toolchain

---

## 2) Installation

### Option A — Monorepo (local path)
If you have the repo checked out with `react-native-heartpy/` inside:

```bash
# from the repo root
yarn add file:react-native-heartpy
# or
npm i file:react-native-heartpy
```

Then:

```bash
# iOS pods
cd ios && pod install && cd ..
```

### Option B — External package
If published to a registry, install the package instead of using the local path:

```bash
yarn add react-native-heartpy
cd ios && pod install && cd ..
```

No additional Android linking steps are required for modern RN (autolinking).

---

## 3) Basic Usage (React Native)

The TypeScript interface is exposed from `react-native-heartpy/src/index.ts`.

```ts
import { analyze, analyzeRR, analyzeSegmentwise, type HeartPyOptions } from 'react-native-heartpy';

// Example: basic signal analysis
const fs = 50; // Hz
const signal: number[] = /* your PPG/ECG samples */ [];

const options: HeartPyOptions = {
  bandpass: { lowHz: 0.5, highHz: 5, order: 2 },
  peak: { refractoryMs: 250, thresholdScale: 0.5, bpmMin: 40, bpmMax: 180 },
  // Keep frequency-domain stable: use ≥ 4 min windows
};

const res = analyze(signal, fs, options);
console.log('BPM', res.bpm, 'RMSSD', res.rmssd, 'LF/HF', res.lfhf);
```

### Streaming RR-only (rolling window)

```ts
import { analyzeRR } from 'react-native-heartpy';

// Maintain a rolling buffer of RR intervals in milliseconds
const rrBuffer: number[] = [];

function onNewRR(rrMs: number) {
  rrBuffer.push(rrMs);
  // Keep last N RR (e.g., 300–600 beats)
  if (rrBuffer.length > 600) rrBuffer.splice(0, rrBuffer.length - 600);

  if (rrBuffer.length >= 30) {
    const res = analyzeRR(rrBuffer, {
      quality: { cleanRR: false },
      breathingAsBpm: false, // Hz to match HeartPy; convert in UI if needed
    });
    // Use time-domain metrics live; treat FD only on long windows
    console.log('BPM', res.bpm, 'RMSSD', res.rmssd);
  }
}
```

### Segmentwise analysis (long recordings)

```ts
const resSeg = analyzeSegmentwise(longSignal, 50, {
  segmentwise: { width: 120, overlap: 0.5, minSize: 30, replaceOutliers: true },
  quality: { rejectSegmentwise: true }
});

console.log('Avg BPM', resSeg.bpm, 'Segments', resSeg.segments?.length ?? 0);
```

---

## 4) Options (Mobile‑focused)

- Bandpass: `{ lowHz, highHz, order }` (disable if you have prefiltered data)
- Welch PSD: `{ nfft, overlap, wsizeSec }` (FD reliable on ≥ 4 min windows)
- Peaks: `{ refractoryMs, thresholdScale, bpmMin, bpmMax }`
- Quality: `{ cleanRR, cleanMethod, rejectSegmentwise, segmentRejectMaxRejects }`
- RR Smoothing: `{ rrSpline: { s, targetSse, smooth } }` (stabilizes FD/breathing on short windows)
- Breathing: `breathingAsBpm: boolean` (Hz by default; true returns breaths/min)

Key parity notes:
- pNN uses strict `>` with 1e‑6 rounding alignment (HeartPy parity).
- Masked pairs: diffs counted only when both adjacent beats are valid.

---

## 5) iOS Integration Notes

- The iOS bridge (`ios/HeartPyModule.mm`) exposes C++ via Obj‑C++/JSI.
- Use `pod install` after adding the package.
- Build settings: C++17, `-O3 -DNDEBUG` for Release.
- Background work: schedule periodic analysis with BackgroundTasks; keep FD out of the main thread.

---

## 6) Android Integration Notes

- JNI bridge at `android/src/main/cpp/native_analyze.cpp`.
- Gradle/NDK: ensure CMake 3.15+; default `CMAKE_CXX_STANDARD 17` is set.
- Keep analysis on a worker thread; avoid frequent allocations across the JNI boundary.

---

## 7) Performance & Battery Tips

- Time‑domain metrics are suitable for live/short windows.
- Perform FD metrics and breathing on ≥ 4 min windows.
- Disable extra bandpass in C++ if you already prefilter in JS/Native.
- Use `nfft` as a power of two for faster FFT; otherwise DFT fallback is used.
- Use masked metrics (enable `threshold_rr`) on noisy wearables.

---

## 8) Validation & QA

- Run BIDMC comparison: `PYTHONPATH=heartpy_source python3 examples/compare_bidmc.py`
- RR‑only validator: build and run `examples/validate_rr_intervals.cpp`
- MIT‑BIH (requires dataset): see `examples/run_mitbih_validation.py`, `examples/validate_mitbih_rr.py`

Success criteria (DoD):
- Time‑domain parity ≤ 2% avg diff; pNN strict `>`; masked RMSSD/SDSD parity on RR‑only.
- FD comparable on long windows; short windows flagged low‑reliability.

---

## 9) Troubleshooting

- “Short signal” and FD discrepancies: use ≥ 4 min windows; tune `rrSpline.s` for stability.
- Very high LF/HF variance: ensure Hann window + correct `nperseg`; verify units are ms.
- pNN looks 100× off: set `pnnAsPercent=false` (ratio 0..1) or normalize in UI.
- Android build issues: verify NDK/CMake versions and that `CMAKE_CXX_STANDARD 17` is active.

---

## 10) Privacy & Data Handling

- Process on‑device; avoid uploading raw physiological data when not strictly needed.
- Persist only summary metrics and small QC arrays.

---

## 11) Licensing & Attribution

- MIT‑compatible; credit the original HeartPy and this enhanced implementation.

