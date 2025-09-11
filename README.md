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
