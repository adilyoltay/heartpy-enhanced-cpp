## react-native-heartpy

React Native bindings for the enhanced HeartPy-like C++ core. Provides sync and async APIs to compute HR/HRV metrics on-device.

### Install (local path example)

```
yarn add file:./react-native-heartpy
cd android && ./gradlew :app:dependencies && cd -
```

Autolinking should register the package. On app start, call install:

```ts
import { analyzeAsync, installJSI, analyzeJSI } from 'react-native-heartpy';
import BinaryMaskDemo from './examples/BinaryMaskDemo';

// Optional: install iOS JSI binding for direct invocation
installJSI();

const res = await analyzeAsync(ppgArray, 50, {
  bandpass: { lowHz: 0.5, highHz: 5, order: 2 },
  peak: { refractoryMs: 320, thresholdScale: 0.5 },
  quality: { thresholdRR: true, rejectSegmentwise: true, segmentRejectWindowBeats: 10, segmentRejectMaxRejects: 3 },
  // Mobile defaults: save CPU by skipping FD unless needed
  calcFreq: false,
  // For HP‑like filtering, prefer zero‑phase butterworth
  filter: { mode: 'butter-filtfilt', order: 3 },
});

// Render binary mask & segments
<BinaryMaskDemo
  peakListRaw={res.peakListRaw}
  binaryPeakMask={res.binaryPeakMask}
  binarySegments={res.binarySegments}
/>;
```

### Android

- Requires NDK r26+, CMake 3.22+, and React Native New Architecture (Hermes preferred).
- Ensure AGP 8.x and Gradle match RN template. Build types should not strip the native lib.

### iOS

- Objective-C++ and JNI bridges expose both synchronous and Promise-based methods:
  - Sync: `analyze`, `analyzeRR`, `analyzeSegmentwise`, `interpolateClipping`, `hampelFilter`, `scaleData`
  - Async: `analyzeAsync`, `analyzeRRAsync`, `analyzeSegmentwiseAsync` (recommended for long windows)
  - Optional JSI (iOS): `installJSI()` then `analyzeJSI()`

Packaging notes:
- The package vendors the enhanced C++ core under `cpp/` and KissFFT under `third_party/` and builds them automatically on iOS/Android.
- TypeScript sources are compiled to `dist/` during installation.

### Example Usage Component

See `react-native-heartpy/examples/AppUsage.tsx` for a minimal component that:
- Generates synthetic PPG (60s or 300s) and runs `analyzeAsync()`
- Renders time domain metrics and FD metrics, with a short-window warning when `< 240s`.
- Copy it into your app for quick testing.

### Streaming (concepts)

- The C++ library ships a realtime streaming analyzer with a plain C bridge (`hp_rt_*`). The package exposes a NativeModules path by default (JSI optional). Example realtime options:

```ts
import { RealtimeAnalyzer } from 'react-native-heartpy';
const rt = await RealtimeAnalyzer.create(30, {
  bandpass: { lowHz: 0.5, highHz: 5, order: 2 },
  quality: { thresholdRR: true },
  calcFreq: false, // disable FD live
  filter: { mode: 'butter-filtfilt', order: 3 },
  windowSeconds: 12,
});
```

### License

MIT


