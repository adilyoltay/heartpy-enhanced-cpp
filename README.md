# heartpy-enhanced-cpp

Enhanced C++ port of HeartPy with a real‑time streaming analyzer, acceptance tests, and a React Native bridge for mobile.

## Features

- RealtimeAnalyzer for low‑latency HR/RR/HRV on 10–60s windows with 1 Hz updates
- Robust harmonic suppression: PSD‑driven soft/hard + conservative RR‑fallback
- SNR/Confidence estimation (Welch, nfft=1024) with EMA and logistic mapping
- Acceptance tooling (torch/ambient presets) and JSONL telemetry
- React Native bridge (`react-native-heartpy/`) and sample app (`HeartPyApp/`)

## Build & Acceptance

```
cmake -S . -B build-mac -DCMAKE_BUILD_TYPE=Release
cmake --build build-mac -j
cmake --build build-mac --target acceptance
```

### Acceleration Flags

The core supports optional platform acceleration paths:

- `HEARTPY_ENABLE_ACCELERATE` (Apple): Enables vDSP for PSD precompute (mean, mean‑subtract, window multiply). FFT already uses Accelerate when available.
- `HEARTPY_ENABLE_NEON` (ARM): Enables NEON in PSD precompute for mean reduction and windowed multiply.

Configure via CMake options:

```
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  -DHEARTPY_ENABLE_ACCELERATE=ON \
  -DHEARTPY_ENABLE_NEON=ON
```

Both paths are guarded with clean scalar fallbacks to ensure identical behavior within tight numeric tolerances.

### Defaults & Presets

- Streaming defaults (key items):
  - `lowHz=0.5`, `highHz=5.0`, `iirOrder=2`
  - `nfft=1024`, `overlap=0.5`
  - `refractoryMs=320`, `thresholdScale=0.5`, `useHPThreshold=true`, `maPerc=30`
  - Ring buffer: `useRingBuffer=false` (opt‑in)
  - SNR bands: passive ±0.12 Hz, active ±0.18 Hz; EMA τ≈7 s when active
- Presets (streaming):
  - Torch: raises refractory to ≥300 ms; thresholding enabled; bandpass ~0.7–3.0 Hz
  - Ambient: refractory ≥320 ms; thresholding enabled; bandpass ~0.5–3.5 Hz

These reflect current behavior; see `cpp/heartpy_core.h` and `cpp/heartpy_stream.cpp` for the authoritative definitions.

### Precision & Determinism

- `Options.highPrecision` (default OFF): enables a double‑precision filter path in streaming. Internally, filtering runs in double and stores to the existing float buffers to preserve I/O and JSON formats. Use when you need tighter numeric stability; performance remains within mobile targets.
- CLI `--high-precision`: sets `Options.highPrecision=true` in `realtime_demo` for quick A/B.
- `Options.deterministic` (default OFF): runtime determinism toggle.
  - Forces scalar DFT in Welch (bypasses vDSP/NEON/KissFFT) and snaps EMA cadence to fixed PSD intervals; disables band‑width change blending.
  - Implies highPrecision for the filter path.
  - Designed to produce bit‑exact JSONL across repeated runs with the same inputs on the same platform.

Gates are unchanged: 180 s ring‑OFF acceptance remains the blocking check; 60 s smoke is relaxed HR only. Compact JSON emits only acceptance fields and is unaffected by precision/determinism settings.

## Mobile (React Native) Quick Start

Install the RN package in your app (local path example):

```
yarn add file:./react-native-heartpy
```

Enable the New Architecture (Hermes preferred) and build:

- iOS: `cd ios && pod install && cd ..`
- Android: ensure NDK r26+, CMake ≥ 3.22, AGP ≥ 8.x

Basic usage:

```ts
import {installJSI, analyzeAsync} from 'react-native-heartpy';

installJSI(); // optional (JSI path on iOS)

const res = await analyzeAsync(ppgArray, 50, {
  bandpass: {lowHz: 0.5, highHz: 5, order: 2},
  welch: {nfft: 1024, overlap: 0.5},
  peak: {refractoryMs: 320, thresholdScale: 0.5},
});

console.log(res.bpm, res.quality.confidence);
```

For complete mobile guidance (iOS/Android setup, Hermes/NDK/CMake versions, troubleshooting), see `docs/mobile_integration.md` and `react-native-heartpy/README.md`.
