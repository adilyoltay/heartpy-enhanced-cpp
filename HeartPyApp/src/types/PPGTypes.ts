// PPG Type Definitions
// Type-safe interfaces and types for PPG data flow

export interface PPGSample {
  readonly value: number;
  readonly timestamp: number;
  readonly confidence?: number; // Optional confidence from PPGMeanPlugin
}

export type PPGQuality = 'good' | 'poor' | 'unknown';

export interface PPGMetrics {
  readonly bpm: number;
  readonly confidence: number;
  readonly snrDb: number;
  readonly peakList: readonly number[];
  readonly quality: {
    readonly goodQuality: boolean;
    readonly signalQuality: PPGQuality;
    readonly totalBeats: number;
  };
}

export type PPGState = 'idle' | 'starting' | 'running' | 'stopping';

export type PPGError = 'camera' | 'native' | 'buffer' | 'config';
