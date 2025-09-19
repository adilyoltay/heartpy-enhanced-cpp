import {RealtimeAnalyzer} from 'react-native-heartpy';
import {PPG_CONFIG} from './PPGConfig';
import type {PPGMetrics} from '../types/PPGTypes';

// Override QualityInfo to include streaming metrics
type QualityInfo = {
  totalBeats: number;
  rejectedBeats: number;
  rejectionRate: number;
  goodQuality: boolean;
  qualityWarning?: string;
  // Streaming quality metrics (from C++ core)
  confidence?: number;
  snrDb?: number;
  f0Hz?: number;
  maPercActive?: number;
  doublingFlag?: boolean;
  softDoublingFlag?: boolean;
  doublingHintFlag?: boolean;
  hardFallbackActive?: boolean;
  rrFallbackModeActive?: boolean;
  refractoryMsActive?: number;
  minRRBoundMs?: number;
  pairFrac?: number;
  rrShortFrac?: number;
  rrLongMs?: number;
  pHalfOverFund?: number;
};

type HeartPyResult = {
  bpm: number;
  hf: number;
  lf: number;
  totalPower: number;
  quality: QualityInfo;
  peakList: number[];
};

export class HeartPyWrapper {
  private analyzer: RealtimeAnalyzer | null = null;

  async create(sampleRate: number): Promise<void> {
    console.log('[HeartPyWrapper] Create called with sampleRate:', sampleRate);
    if (this.analyzer) {
      console.log('[HeartPyWrapper] Analyzer already exists');
      return;
    }
    
    try {
      // HOTFIX: Disable JSI to prevent EXC_BAD_ACCESS crash
      console.log('[HeartPyWrapper] Loading react-native-heartpy...');
      const {RealtimeAnalyzer} = require('react-native-heartpy');
      
      console.log('[HeartPyWrapper] Setting JSI config...');
      RealtimeAnalyzer.setConfig({jsiEnabled: false, debug: true});
      
      console.log('[HeartPyWrapper] Creating RealtimeAnalyzer...');
      this.analyzer = await RealtimeAnalyzer.create(sampleRate, {
        bandpass: {lowHz: 0.5, highHz: 3.5, order: 2},
        peak: {refractoryMs: 280, bpmMin: 40, bpmMax: 180},
      });
      console.log('[HeartPyWrapper] RealtimeAnalyzer created successfully');
    } catch (error) {
      console.error('[HeartPyWrapper] Create failed:', error);
      throw error;
    }
  }

  async push(samples: Float32Array): Promise<void> {
    if (!this.analyzer) {
      throw new Error('HeartPy analyzer not initialized');
    }
    
    // DETAILED LOG: Track sample push
    console.log('[HeartPyWrapper] push', {
      length: samples.length,
      firstValue: samples[0],
      lastValue: samples[samples.length - 1],
      avgValue: samples.reduce((a, b) => a + b, 0) / samples.length,
    });
    
    await this.analyzer.push(samples);
  }

  async poll(): Promise<PPGMetrics | null> {
    if (!this.analyzer) {
      throw new Error('HeartPy analyzer not initialized');
    }
    console.log('[HeartPyWrapper] poll request');
    const result = await this.analyzer.poll();
    console.log('[HeartPyWrapper] poll response', {
      hasResult: !!result,
      bpm: result?.bpm,
      quality: result?.quality,
      hf: result?.hf,
      lf: result?.lf,
      totalPower: result?.totalPower,
    });
    if (!result) {
      return null;
    }

    const bpm = typeof result.bpm === 'number' ? result.bpm : 0;

    // HeartPy provides real confidence/snrDb in quality object
    const quality = result.quality ?? {};
    const goodQuality = quality.goodQuality === true;
    const totalBeats =
      typeof quality.totalBeats === 'number' ? quality.totalBeats : 0;
    const rejectionRate =
      typeof quality.rejectionRate === 'number' ? quality.rejectionRate : 1;

    // PRIORITIZE native confidence/snrDb from HeartPy C++ core
    const nativeConfidence = (quality as any).confidence;
    const nativeSnrDb = (quality as any).snrDb;
    
    // DEBUG: Log native vs synthetic values
    if (PPG_CONFIG.debug.enabled) {
      console.log('[HeartPyWrapper] Native metrics:', {
        nativeConfidence,
        nativeSnrDb,
        goodQuality,
        rejectionRate,
      });
    }
    
    // Use native values if available, otherwise synthetic fallback
    const confidence = typeof nativeConfidence === 'number' ? nativeConfidence : 
      (goodQuality ? Math.max(0.7, 1 - rejectionRate) : Math.min(0.3, 1 - rejectionRate));
    
    const snrDb = typeof nativeSnrDb === 'number' ? nativeSnrDb : 
      (goodQuality && result.totalPower > 0 ? 
        Math.log10(Math.max(result.hf + result.lf, 0.01) / Math.max(result.totalPower - result.hf - result.lf, 0.01)) * 10 : -10);

    let signalQuality: 'good' | 'poor' | 'unknown' = 'unknown';
    if (goodQuality && confidence > 0.6) {
      signalQuality = 'good';
    } else if (confidence < 0.3 || snrDb < -5) {
      signalQuality = 'poor';
    }

    return {
      bpm,
      confidence,
      snrDb,
      peakList: result.peakList || [],
      quality: {
        goodQuality,
        signalQuality,
        totalBeats,
      },
    };
  }

  async destroy(): Promise<void> {
    if (!this.analyzer) {
      return;
    }
    await this.analyzer.destroy();
    this.analyzer = null;
  }
}
