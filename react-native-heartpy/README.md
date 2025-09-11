## react-native-heartpy

React Native bindings for a HeartPy-like C++ core. Provides `analyze(signal, fs, options)` to compute HR/HRV metrics on-device via JSI.

### Install (local path example)

```
yarn add file:./react-native-heartpy
cd android && ./gradlew :app:dependencies && cd -
```

Autolinking should register the package. On app start, call install:

```ts
import { NativeModules } from 'react-native';
import { analyze } from 'react-native-heartpy';
import BinaryMaskDemo from './examples/BinaryMaskDemo';

NativeModules.HeartPyModule.installJSI();

const res = analyze(ppgArray, 50, {
  bandpass: { lowHz: 0.5, highHz: 5, order: 2 },
  welch: { nfft: 256, overlap: 0.5 },
  peak: { refractoryMs: 250, thresholdScale: 0.5 },
  quality: { rejectSegmentwise: true, segmentRejectWindowBeats: 10, segmentRejectMaxRejects: 3 },
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

### iOS

- Objective-C++ bridge provided via `HeartPyModule` with synchronous methods:
  - `analyze(signal, fs, options)`
  - `analyzeRR(rrIntervals, options)`
  - `analyzeSegmentwise(signal, fs, options)`
  - `interpolateClipping(signal, fs, threshold)`
  - `hampelFilter(signal, windowSize, threshold)`
  - `scaleData(signal, newMin, newMax)`
  - Install JSI optional: `HeartPyModule.installJSI()`

### License

MIT


