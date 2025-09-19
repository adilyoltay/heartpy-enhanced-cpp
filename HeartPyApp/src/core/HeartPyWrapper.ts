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

  setBufferRef(buffer: RingBuffer<number>): void {
    this.bufferRef = buffer;
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
      const windowSeconds = PPG_CONFIG.analysis.analysisWindow / sampleRate;
      const segmentWindowBeats = Math.max(4, Math.round((windowSeconds * 80) / 60));
      
      // CRITICAL: Configure Welch window for 3s analysis window
      const welchConfig = {
        wsizeSec: 3, // Match our 90-sample window (3s at 30fps)
        nfft: 128,   // Smaller FFT for faster computation
        overlap: 0.5, // 50% overlap for smoother PSD
      };
      
      this.analyzer = await RealtimeAnalyzer.create(sampleRate, {
        bandpass: {lowHz: 0.5, highHz: 3.5, order: 2},
        peak: {refractoryMs: 280, bpmMin: 40, bpmMax: 180},
        quality: {
          rejectSegmentwise: true,
          segmentRejectWindowBeats: segmentWindowBeats,
          segmentRejectMaxRejects: 2,
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
    const confidence = typeof nativeConfidence === 'number' && nativeConfidence > 0 ? nativeConfidence : 
      (goodQuality ? Math.max(0.7, 1 - rejectionRate) : Math.min(0.3, 1 - rejectionRate));
    
    const snrDb = typeof nativeSnrDb === 'number' && nativeSnrDb > 0 ? nativeSnrDb : 
      (goodQuality && typeof result.totalPower === 'number' && typeof result.hf === 'number' && typeof result.lf === 'number' && 
       result.totalPower > 0 && result.hf >= 0 && result.lf >= 0 ? 
        (() => {
          const calculatedSnr = Math.log10(Math.max(result.hf + result.lf, 0.01) / Math.max(result.totalPower - result.hf - result.lf, 0.01)) * 10;
          return Number.isFinite(calculatedSnr) ? calculatedSnr : -10;
        })() : -10);

    let signalQuality: 'good' | 'poor' | 'unknown' = 'unknown';
    if (goodQuality && confidence > 0.6) {
      signalQuality = 'good';
    } else if (confidence < 0.3 || snrDb < -5) {
      signalQuality = 'poor';
    }

    // CRITICAL: Filter peak list and convert to relative indices for UI display
    // Use HeartPy's actual buffer size, not our RingBuffer size
    const heartPyBufferSize = PPG_CONFIG.analysis.bufferSize; // 450 samples (15s at 30fps)
    const waveformLength = PPG_CONFIG.ui.waveformSamples; // 150 samples
    const waveformStart = Math.max(0, heartPyBufferSize - waveformLength);
    
    // Filter peaks within the current waveform window and convert to relative indices
    const filteredPeakList = (result.peakList || [])
      .filter(peakIndex => peakIndex >= waveformStart && peakIndex < heartPyBufferSize)
      .map(peakIndex => peakIndex - waveformStart); // Convert to relative index (0-149)
    
    console.log('[HeartPyWrapper] Peak list filtering', {
      originalPeaks: result.peakList?.length || 0,
      filteredPeaks: filteredPeakList.length,
      waveformStart: waveformStart,
      heartPyBufferSize: heartPyBufferSize,
      waveformLength: waveformLength,
      relativePeaks: filteredPeakList,
    });

    return {
      bpm,
      confidence,
      snrDb,
      peakList: filteredPeakList,
      quality: {
        goodQuality,
        signalQuality,
        totalBeats,
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
      await this.create(PPG_CONFIG.analysis.sampleRate);
      console.log('[HeartPyWrapper] Analyzer session reset successfully');
    } catch (error) {
      console.error('[HeartPyWrapper] Reset failed:', error);
      throw error;
    }
  }
}
