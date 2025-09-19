export type PPGError = 'camera' | 'native' | 'buffer' | 'config';

export type PPGState = 'idle' | 'starting' | 'running' | 'stopping';

export type PPGQuality = 'good' | 'poor' | 'unknown';

export interface PPGSample {
  readonly value: number;
  readonly timestamp: number;
}

export interface PPGMetrics {
  readonly bpm: number;
  readonly confidence: number;
  readonly snr: number;
  readonly quality: PPGQuality;
}

export interface NativePollQuality {
  readonly qualityFlag: PPGQuality;
  readonly totalBeats: number;
  readonly goodQuality: boolean;
}

export interface NativePollResult {
  readonly bpm: number;
  readonly confidence: number;
  readonly snr: number;
  readonly quality: NativePollQuality;
}

export type HeartPyHandle = number;

export interface HeartPyNativeModule {
  readonly create: (sampleRate: number) => Promise<HeartPyHandle>;
  readonly push: (handle: HeartPyHandle, samples: Float32Array) => Promise<void>;
  readonly poll: (handle: HeartPyHandle) => Promise<NativePollResult | null>;
  readonly destroy: (handle: HeartPyHandle) => Promise<void>;
}
