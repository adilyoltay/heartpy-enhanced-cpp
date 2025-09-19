// PPG Configuration Constants
// All configuration values in one place with type safety

// Environment-based debug flag
const isDebugMode = __DEV__ || process.env.NODE_ENV === 'development';

export const PPG_CONFIG = {
  camera: {
    fps: 30,
    torchLevel: 0.3,
    roi: 0.5,
  },
  analysis: {
    sampleRate: 30,
    bufferSize: 450,
    analysisWindow: 90, // Reduced from 150 to 90 samples (3s instead of 5s) for faster response
  },
  ui: {
    updateInterval: 50, // Reduced from 100ms to 50ms for faster UI updates
    waveformSamples: 150,
  },
  debug: {
    enabled: isDebugMode, // Auto-enable in development, disable in production
    sampleLogThrottle: 30, // Log every Nth sample
  },
} as const;
