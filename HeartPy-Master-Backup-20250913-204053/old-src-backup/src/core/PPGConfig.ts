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
} as const;
