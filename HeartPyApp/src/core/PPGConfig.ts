// PPG Configuration Constants
// All configuration values in one place with type safety

export const PPG_CONFIG = {
  camera: {
    fps: 30,
    torchLevel: 0.3,
    roi: 0.5,
  },
  analysis: {
    sampleRate: 30,
    bufferSize: 450,
    analysisWindow: 150,
  },
  ui: {
    updateInterval: 100,
    waveformSamples: 150,
  },
  debug: {
    enabled: true, // Set to true for verbose logging
    sampleLogThrottle: 30, // Log every Nth sample
  },
} as const;
