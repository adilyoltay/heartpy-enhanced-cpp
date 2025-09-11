export const NativeModules = {
  HeartPyModule: {
    analyze: jest.fn((signal: number[], fs: number, options: any) => defaultResult()),
    analyzeAsync: jest.fn((signal: number[], fs: number, options: any) => Promise.resolve(defaultResult() as any)),
    analyzeRR: jest.fn((rr: number[], options: any) => defaultResult()),
    analyzeRRAsync: jest.fn((rr: number[], options: any) => Promise.resolve(defaultResult() as any)),
    analyzeSegmentwise: jest.fn((signal: number[], fs: number, options: any) => defaultResult()),
    analyzeSegmentwiseAsync: jest.fn((signal: number[], fs: number, options: any) => Promise.resolve(defaultResult() as any)),
    interpolateClipping: jest.fn((signal: number[], fs: number, thr: number) => signal),
    hampelFilter: jest.fn((signal: number[], win: number, thr: number) => signal),
    scaleData: jest.fn((signal: number[], a: number, b: number) => signal),
    installJSI: jest.fn(() => true),
  },
};

function defaultResult() {
  return {
    bpm: 60,
    ibiMs: [],
    rrList: [],
    peakList: [],
    sdnn: 30,
    rmssd: 25,
    sdsd: 25,
    pnn20: 0.1,
    pnn50: 0.05,
    nn20: 10,
    nn50: 5,
    mad: 15,
    sd1: 10,
    sd2: 20,
    sd1sd2Ratio: 0.5,
    ellipseArea: 628,
    vlf: 0,
    lf: 0,
    hf: 0,
    lfhf: 0,
    totalPower: 0,
    lfNorm: 0,
    hfNorm: 0,
    breathingRate: 0.2,
    quality: { totalBeats: 0, rejectedBeats: 0, rejectionRate: 0, goodQuality: true },
    segments: [],
  } as const;
}

export default { NativeModules };
