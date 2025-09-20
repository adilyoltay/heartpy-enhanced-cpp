import {RealtimeAnalyzer} from 'react-native-heartpy';
import {PPG_CONFIG} from './PPGConfig';
import {RingBuffer} from './RingBuffer';
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
  private bufferRef: RingBuffer<number> | null = null; // Reference to analyzer's buffer
  private lastCameraConfidence: number = 0.85; // Track camera confidence for fallback

  setBufferRef(buffer: RingBuffer<number>): void {
    this.bufferRef = buffer;
  }

  updateCameraConfidence(confidence: number): void {
    this.lastCameraConfidence = confidence;
  }

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
      const windowSamples = PPG_CONFIG.analysisWindow;
      const windowSeconds = windowSamples / sampleRate;
      const segmentRejectWindowBeats = Math.max(4, Math.round(windowSeconds));
      const segmentRejectMaxRejects = Math.max(0, segmentRejectWindowBeats - 1);
      
      // CRITICAL: Configure Welch window to match our analysis window
      const welchConfig = {
        wsizeSec: windowSeconds, // Use actual window size (3s for 90 samples at 30fps)
        nfft: Math.max(64, Math.pow(2, Math.ceil(Math.log2(windowSeconds * sampleRate)))), // Power of 2, minimum 64
        overlap: 0.5, // 50% overlap for smoother PSD
      };
      
      this.analyzer = await RealtimeAnalyzer.create(sampleRate, {
        bandpass: {lowHz: 0.3, highHz: 4.5, order: 2}, // Even wider bandpass for better signal capture
        peak: {refractoryMs: 150, bpmMin: 40, bpmMax: 180}, // Further reduced refractoryMs for maximum sensitivity
        quality: {
          rejectSegmentwise: true,
          segmentRejectWindowBeats,
          segmentRejectMaxRejects,
        },
        windowSeconds,
        welch: welchConfig, // Add Welch configuration
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

  async pushWithTimestamps(samples: number[] | Float32Array, timestamps: number[] | Float64Array): Promise<void> {
    if (!this.analyzer) {
      throw new Error('HeartPy analyzer not initialized');
    }
    
    try {
      // Convert to typed arrays for better performance and GC
      const samplesArray = samples instanceof Float32Array ? samples : new Float32Array(samples);
      const timestampsArray = timestamps instanceof Float64Array ? timestamps : new Float64Array(timestamps);
      
      console.log('[HeartPyWrapper] pushWithTimestamps', {
        sampleCount: samplesArray.length,
        timestampCount: timestampsArray.length,
        firstValue: samplesArray[0],
        firstTimestamp: timestampsArray[0],
      });
      
      await this.analyzer.pushWithTimestamps(samplesArray, timestampsArray);
    } catch (error) {
      console.error('[HeartPyWrapper] pushWithTimestamps failed', error);
      // Re-throw with more context
      if (error instanceof Error && error.message.includes('destroyed')) {
        throw new Error('RealtimeAnalyzer destroyed during pushWithTimestamps');
      }
      throw error;
    }
  }

  async poll(): Promise<PPGMetrics | null> {
    if (!this.analyzer) {
      throw new Error('HeartPy analyzer not initialized');
    }
    
    try {
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
      typeof quality.rejectionRate === 'number' ? quality.rejectionRate : 0;

    // PRIORITIZE native confidence/snrDb from HeartPy C++ core
    const nativeConfidence = (quality as any).confidence;
    const nativeSnrDb = (quality as any).snrDb;

    let snrDb = typeof nativeSnrDb === 'number' && nativeSnrDb > 0
      ? nativeSnrDb
      : null;

    // DEBUG: Log native vs synthetic values
    if (PPG_CONFIG.debug.enabled) {
      console.log('[HeartPyWrapper] Native metrics:', {
        nativeConfidence,
        nativeSnrDb,
        goodQuality,
        rejectionRate,
      });
    }
    
    // CONFIDENCE FALLBACK: Preserve native warm-up confidence (0 = warm-up)
    let confidence: number;
    if (typeof nativeConfidence === 'number') {
      // Native confidence is available (including 0 for warm-up)
      confidence = nativeConfidence;
      if (confidence <= 0.0 && this.lastCameraConfidence > 0.05) {
        confidence = Math.max(confidence, this.lastCameraConfidence * 0.5);
      }
    } else if (this.lastCameraConfidence > 0.1) {
      // Use camera confidence only when native confidence is undefined/NaN
      confidence = this.lastCameraConfidence;
    } else {
      // Synthetic fallback
      confidence = goodQuality ? Math.max(0.7, 1 - rejectionRate) : Math.min(0.3, 1 - rejectionRate);
    }
    
    if (snrDb == null && goodQuality && typeof result.totalPower === 'number' && typeof result.hf === 'number' && typeof result.lf === 'number' && result.totalPower > 0) {
      const calculatedSnr = Math.log10(Math.max(result.hf + result.lf, 0.01) / Math.max(result.totalPower - result.hf - result.lf, 0.01)) * 10;
      if (Number.isFinite(calculatedSnr)) snrDb = calculatedSnr;
    }

    if (snrDb == null) {
      const tail = this.getAnalysisTail();
      if (tail) {
        snrDb = this.computeSnrFallbackDb(tail);
      }
    }
    if (snrDb == null) snrDb = -10;

    const hasResult = result.hasResult === true;

    let signalQuality: 'good' | 'poor' | 'unknown' = 'unknown';
    if (goodQuality && confidence >= 0.35) { // Require moderate confidence to mark as good
      signalQuality = 'good';
    } else if (confidence < 0.15 || snrDb < -8) { // Flag poor when confidence collapses or SNR very low
      signalQuality = 'poor';
    }

    // Normalize HeartPy peak indices from analyzer ring buffer into the UI waveform window
    const rawPeakList: number[] = Array.isArray(result.peakList)
      ? result.peakList.filter((peak): peak is number => typeof peak === 'number' && Number.isFinite(peak))
      : [];

    const waveformSamples = PPG_CONFIG.waveformTailSamples;
    const bufferLengthRaw = this.bufferRef?.getLength() ?? waveformSamples;
    const waveformStart = Math.max(0, bufferLengthRaw - waveformSamples);

    const filteredPeaks = rawPeakList
      .map((peak) => Math.round(peak))
      .filter((peak) => peak >= waveformStart && peak < bufferLengthRaw);

    const peakList: number[] = filteredPeaks.map((peak) => peak - waveformStart);

    if (rawPeakList.length > 0) {
      console.log('[HeartPyWrapper] Peak list normalization (fixed)', {
        bufferLength: bufferLengthRaw,
        waveformStart,
        originalPeaks: rawPeakList,
        filteredPeaks,
        normalizedPeaks: peakList,
      });
    }

    return {
      bpm,
      confidence,
      snrDb,
      hasResult,
      peakList,
      quality: {
        goodQuality,
        signalQuality,
        totalBeats,
        rejectionRate,
      },
    };
    } catch (error) {
      console.error('[HeartPyWrapper] poll failed', error);
      // Re-throw with more context
      if (error instanceof Error && error.message.includes('destroyed')) {
        throw new Error('RealtimeAnalyzer destroyed during poll');
      }
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (!this.analyzer) {
      return;
    }
    await this.analyzer.destroy();
    this.analyzer = null;
  }

  private getAnalysisTail(): Float32Array | null {
    if (!this.bufferRef) return null;
    const data = this.bufferRef.getAll();
    if (data.length === 0) return null;
    const window = PPG_CONFIG.analysisWindow;
    const tail = data.slice(-window);
    if (tail.length === 0) return null;
    return Float32Array.from(tail);
  }

  private computeSnrFallbackDb(window: Float32Array): number {
    if (window.length < 16) return -10;
    let min = Infinity;
    let max = -Infinity;
    let sumSq = 0;
    for (let i = 0; i < window.length; i += 1) {
      const v = window[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sumSq += v * v;
    }
    const peakToPeak = max - min;
    const rms = Math.sqrt(sumSq / window.length);
    const noiseRms = Math.max(1e-6, Math.min(rms, peakToPeak / 2));
    const snr = (peakToPeak / 2) / noiseRms;
    return 20 * Math.log10(Math.max(snr, 1e-6));
  }

  async reset(): Promise<void> {
    if (!this.analyzer) {
      console.warn('[HeartPyWrapper] Cannot reset - analyzer not initialized');
      return;
    }
    
    try {
      console.log('[HeartPyWrapper] Resetting analyzer session');
      // Note: RealtimeAnalyzer doesn't have a direct reset method
      // We'll recreate it instead
      await this.destroy();
      await this.create(PPG_CONFIG.sampleRate);
      console.log('[HeartPyWrapper] Analyzer session reset successfully');
    } catch (error) {
      console.error('[HeartPyWrapper] Reset failed:', error);
      throw error;
    }
  }
}
