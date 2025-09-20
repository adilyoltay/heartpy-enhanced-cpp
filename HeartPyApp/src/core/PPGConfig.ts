// PPG Configuration Constants
// All configuration values in one place with type safety

// Environment-based debug flag
const isDebugMode = __DEV__ || process.env.NODE_ENV === 'development';

export const PPG_CONFIG = {
  // Sampling & buffering
  sampleRate: 30,
  analysisWindow: 150,          // samples (~5 s @ 30 Hz)
  ringBufferSize: 450,          // analyzer/history buffer length
  waveformTailSamples: 150,      // UI waveform tail displayed
  expectedBpm: 75,              // average BPM used for segment rejection tuning

  // Reliability & gating
  reliabilityThreshold: 0.6,
  snrDbThresholdUI: -3,

  // Adaptive gain control (AGC)
  enableAGC: true,
  amplitudeTargetRMS: 0.02,
  agcAlphaRms: 0.05,
  agcAlphaGain: 0.1,
  agcGainMin: 0.5,
  agcGainMax: 20,

  // Analyzer warm-up / batching
  minSamplesBeforePollSec: 6.0, // P0 FIX: Increased from 1.5s to 6s for BPM stability
  microBatchSamples: 16,
  microBatchLatencyMs: 150,

  // Camera preferences
  ppgChannel: 'red',            // 'red' (torch) | 'green'
  roiBoxPct: 0.5,               // central box (fraction of width/height)
  cameraTorchLevel: 1.0,

  // UI refresh cadence
  uiUpdateIntervalMs: 50,

  debug: {
    enabled: isDebugMode,
    sampleLogThrottle: 30,
  },
} as const;
