## Mobile Integration Guide (React Native)

This guide explains how to integrate the enhanced HeartPy C++ core in React Native apps for on‑device HR/RR/HRV and quality metrics.

### Requirements

- React Native New Architecture (Fabric/TurboModules), Hermes recommended
- Android: NDK r26+, CMake ≥ 3.22, AGP ≥ 8.x
- iOS: Xcode 14+, CocoaPods

### Install

Install the local package:

```
yarn add file:../react-native-heartpy
```

Autolinking registers the module. For iOS, run:

```
cd ios && pod install && cd ..
```

### Build Settings

#### Android

- Ensure `android/build.gradle` and `gradle.properties` target NDK r26+ and CMake ≥ 3.22.
- Keep `org.gradle.jvmargs=-Xmx4096m` to speed native builds.
- Hermes enabled (recommended).

#### iOS

- Hermes enabled in `Podfile` is recommended; JSI path available on iOS.
- The package vendors the C++ core and KissFFT and builds them automatically via CocoaPods.

### Usage (Batch)

```ts
import { analyzeAsync, installJSI } from 'react-native-heartpy';

installJSI(); // optional (iOS direct JSI)

const fs = 50; // Hz
const res = await analyzeAsync(ppgArray, fs, {
  bandpass: { lowHz: 0.5, highHz: 5, order: 2 },
  welch: { nfft: 1024, overlap: 0.5 },
  peak: { refractoryMs: 320, thresholdScale: 0.5 },
  quality: { rejectSegmentwise: true, segmentRejectWindowBeats: 10, segmentRejectMaxRejects: 3 },
});

console.log(res.bpm, res.quality.confidence);
```

### Usage (Realtime streaming – concepts)

The C++ streaming API (`RealtimeAnalyzer`) exposes a plain C bridge (`hp_rt_*`) for push/poll. The RN package focuses on batch APIs, but you can:

1) Wire a thin TurboModule/JSI binding to the C bridge symbols (`hp_rt_create`, `hp_rt_push`, `hp_rt_poll`, `hp_rt_destroy`), or
2) Use short batch windows (e.g., 2–3 s overlapped) as a simple streaming approximation.

Key streaming guards to preserve:

- Warm‑up: t ≥ 15 s & acceptedRR ≥ 10 before trusting soft/hard/hint and confidence.
- Harmonic suppression: PSD‑driven soft/hard; RR‑fallback hint for clean high‑HR short‑RR modes.
- Chain‑active min‑RR gate: 0.86 × longRR_est (clamped), only when flags active.
- RR‑fallback: periodic suppression OFF; minimal merge with strict caps; safety brake enabled.

### Performance & SNR/Confidence

- Welch uses `nfft=1024` by default (df≈0.049 Hz). At 1 Hz cadence this is within mobile CPU budgets.
- Active SNR band ±0.18 Hz (passive ±0.12 Hz); EMA τ≈7 s in active to stabilize confidence.

### Troubleshooting

- Build errors on Android: verify NDK r26, CMake ≥ 3.22, and that New Architecture is enabled.
- iOS: run `pod deintegrate && pod install` if headers drift; ensure Hermes and the New Architecture are on.
- Low confidence early: warm‑up gate zeros confidence until ≥15 s or ≥15 beats.
- “Doubled” HR on clean sine: unlock chain (soft/hard/hint) corrects to ~72 BPM; acceptance target guards this behavior.

### Demo App

See `HeartPyApp/` for a RN app template. It shows how to call the module, renders HR/confidence, and includes an example component. Attach it to camera PPG for end‑to‑end testing.

