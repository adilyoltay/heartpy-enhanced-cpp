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
      const expectedBeatsInWindow = (PPG_CONFIG.expectedBpm / 60) * windowSeconds;

      // FIXED: Use actual window duration (5 seconds) for segment rejection
      const rejectionWindowSeconds = PPG_CONFIG.analysisWindow / 30; // Convert samples to seconds (150/30=5s)
      const segmentRejectWindowBeats = Math.max(4, Math.round(PPG_CONFIG.expectedBpm / 60 * rejectionWindowSeconds));
      const segmentRejectMaxRejects = Math.max(2, Math.floor(segmentRejectWindowBeats * 0.3)); // 30% rejection rate

      // CRITICAL: Configure Welch window to match our analysis window
      const welchConfig = {
        wsizeSec: windowSeconds, // Use actual window size (5s for 150 samples at 30fps)
        nfft: Math.max(64, Math.pow(2, Math.ceil(Math.log2(windowSeconds * sampleRate)))), // Power of 2, minimum 64
        overlap: 0.5, // 50% overlap for smoother PSD
      };
      
      this.analyzer = await RealtimeAnalyzer.create(sampleRate, {
        bandpass: {lowHz: 0.3, highHz: 4.5, order: 2}, // Even wider bandpass for better signal capture
        peak: {refractoryMs: 150, bpmMin: 40, bpmMax: 180}, // FIXED: Removed unsupported parameters
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

      const native = result as Partial<HeartPyResult>;
      const quality = native?.quality ?? {};

      const goodQuality = (quality as any).goodQuality === true;
      const totalBeats =
        typeof (quality as any).totalBeats === 'number' ? (quality as any).totalBeats : 0;
      const rejectionRateRaw =
        typeof (quality as any).rejectionRate === 'number'
          ? (quality as any).rejectionRate
          : undefined;

      let snrDb =
        typeof (quality as any).snrDb === 'number' && (quality as any).snrDb !== 0
          ? (quality as any).snrDb
          : undefined;

      if (snrDb == null) {
        const tail = this.getAnalysisTail();
        if (tail) {
          snrDb = this.computeSnrFallbackDb(tail);
        }
      }
      const normalizedSnrDb = snrDb ?? -10;

      const snrScore = Math.min(
        1,
        Math.max(0, (normalizedSnrDb - PPG_CONFIG.snrDbThresholdUI) / 12),
      );
      const rejectionRateClamped = Math.min(
        1,
        Math.max(0, rejectionRateRaw ?? 0),
      );
      const rejectionScore = 1 - rejectionRateClamped;
      const qualityScore = goodQuality ? 1 : 0;

      const confidence =
        0.6 * qualityScore + 0.3 * snrScore + 0.1 * rejectionScore;

      let signalQuality: 'good' | 'poor' | 'unknown' = 'unknown';
      if (goodQuality && confidence >= PPG_CONFIG.reliabilityThreshold) {
        signalQuality = 'good';
      } else if (
        confidence < 0.3 ||
        normalizedSnrDb < PPG_CONFIG.snrDbThresholdUI
      ) {
        signalQuality = 'poor';
      }

      const rawPeakList = Array.isArray(native?.peakList) ? native.peakList : [];
      const peakList = this.normalizePeaks(rawPeakList);

      if (PPG_CONFIG.debug.enabled) {
        console.log('[HeartPyWrapper] Native peak data', {
          rawPeakList,
          normalizedPeaks: peakList,
          bufferLength: this.bufferRef?.getLength() ?? 0,
          windowSize: PPG_CONFIG.waveformTailSamples,
        });
      }

      const metrics: PPGMetrics = {
        bpm: typeof native?.bpm === 'number' ? native.bpm : 0,
        confidence,
        snrDb: normalizedSnrDb,
        hasResult: goodQuality,
        peakList,
        quality: {
          goodQuality,
          signalQuality,
          totalBeats,
          rejectionRate: rejectionRateRaw,
        },
      };

      if (PPG_CONFIG.debug.enabled) {
        console.log('[HeartPyWrapper] Native metrics', {
          bpm: metrics.bpm,
          confidence: metrics.confidence,
          snrDb: metrics.snrDb,
          hasResult: metrics.hasResult,
          totalBeats: metrics.quality.totalBeats,
          rejectionRate: metrics.quality.rejectionRate,
          signalQuality: metrics.quality.signalQuality,
          peakCount: metrics.peakList.length,
        });
      }

      return metrics;
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

  private normalizePeaks(rawPeaks: number[]): number[] {
    if (!Array.isArray(rawPeaks) || rawPeaks.length === 0) {
      if (PPG_CONFIG.debug.enabled) {
        console.log('[HeartPyWrapper] Peak normalization: no raw peaks', {rawPeaks});
      }
      return [];
    }

    const sanitizedPeaks = rawPeaks
      .filter((peak): peak is number => typeof peak === 'number' && Number.isFinite(peak))
      .map((peak) => Math.round(peak));

    if (PPG_CONFIG.debug.enabled) {
      console.log('[HeartPyWrapper] Peak normalization: raw vs sanitized', {
        rawPeaks,
        sanitizedPeaks,
        filteredCount: sanitizedPeaks.length
      });
    }

    if (sanitizedPeaks.length === 0) {
      if (PPG_CONFIG.debug.enabled) {
        console.log('[HeartPyWrapper] Peak normalization: no valid peaks after sanitization');
      }
      return [];
    }

    const ringBuffer = this.bufferRef;
    if (!ringBuffer) {
      // FIXED: If no buffer, return first few peaks as-is (fallback for early detection)
      const maxPeaks = Math.min(sanitizedPeaks.length, PPG_CONFIG.waveformTailSamples);
      return sanitizedPeaks.slice(0, maxPeaks).filter((peak) => peak >= 0);
    }

    const bufferLength = ringBuffer.getLength();
    if (bufferLength <= 0) {
      return [];
    }

    const windowSize = PPG_CONFIG.waveformTailSamples;
    const windowStart = Math.max(0, bufferLength - windowSize);
    const windowEnd = bufferLength;

    // P0 FIX: Correct peak index normalization for window-relative indices
    // When buffer is full, native peaks are often relative to the current processing window
    // We need to map them to the display window correctly
    let adjustedPeaks = sanitizedPeaks;
    
    if (bufferLength >= windowSize) {
      // Buffer is full - peaks are likely relative to current processing window
      const maxPeak = Math.max(...sanitizedPeaks);
      const minPeak = Math.min(...sanitizedPeaks);
      
      // If all peaks are below windowStart, they're likely relative to processing window start
      if (maxPeak < windowStart) {
        // Shift peaks to align with current display window
        const processingWindowStart = Math.max(0, bufferLength - PPG_CONFIG.analysisWindow);
        const shift = processingWindowStart;
        adjustedPeaks = sanitizedPeaks.map(p => p + shift);
        
        if (PPG_CONFIG.debug.enabled) {
          console.log('[HeartPyWrapper] Peak index correction applied', {
            originalPeaks: sanitizedPeaks,
            processingWindowStart,
            shift,
            adjustedPeaks,
            windowStart,
            windowEnd
          });
        }
      }
    }

    // FIXED: More lenient filtering - allow peaks from a wider range
    // If buffer is full, use the last windowSize samples
    // If buffer is not full yet, use all available data
    const filtered = adjustedPeaks.filter((peak) => {
      if (bufferLength >= windowSize) {
        // Buffer full: only show peaks in the last windowSize samples
        return peak >= windowStart && peak < windowEnd;
      } else {
        // Buffer not full yet: show all peaks that fit in the current buffer
        return peak >= 0 && peak < bufferLength;
      }
    });

    if (filtered.length === 0) {
      if (PPG_CONFIG.debug.enabled) {
        console.log('[HeartPyWrapper] Peak normalization filtered all peaks', {
          bufferLength,
          windowSize,
          windowStart,
          windowEnd,
          sanitizedPeaks,
          adjustedPeaks,
          bufferFull: bufferLength >= windowSize,
        });
      }
      return [];
    }

    const normalized = filtered.map((peak) => {
      if (bufferLength >= windowSize) {
        return peak - windowStart; // Standard normalization
      } else {
        return peak; // Early detection - no offset needed
      }
    });

    if (PPG_CONFIG.debug.enabled) {
      console.log('[HeartPyWrapper] Peak list normalization', {
        bufferLength,
        windowSize,
        windowStart,
        windowEnd,
        rawPeaks,
        sanitizedPeaks,
        adjustedPeaks,
        filtered,
        normalized,
        bufferFull: bufferLength >= windowSize,
      });
    }

    return normalized;
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
