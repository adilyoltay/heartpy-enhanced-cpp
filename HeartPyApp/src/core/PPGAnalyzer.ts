import type {PPGMetrics, PPGSample, PPGState} from '../types/PPGTypes';
import {PPG_CONFIG} from './PPGConfig';
import {HeartPyWrapper} from './HeartPyWrapper';
import {RingBuffer} from './RingBuffer';

interface AnalyzerOptions {
  onMetrics: (metrics: PPGMetrics, waveform: number[]) => void;
  onStateChange?: (state: PPGState) => void;
  onFpsUpdate?: (fps: number) => void; // FPS callback for dynamic sampleRate
}

export class PPGAnalyzer {
  private state: PPGState = 'idle';
  private readonly wrapper = new HeartPyWrapper();
  private readonly buffer = new RingBuffer<number>(
    PPG_CONFIG.ringBufferSize,
  );
  private timer: NodeJS.Timeout | null = null;
  private readonly pending: number[] = [];
  private readonly pendingTimestamps: number[] = [];
  private sampleCount = 0; // Sample counter for accurate throttling
  private totalPushed = 0;
  private lastFlushTimestampMs = 0;
  private readonly onMetrics: (metrics: PPGMetrics, waveform: number[]) => void;
  private readonly onStateChange?: (state: PPGState) => void;
  private readonly onFpsUpdate?: (fps: number) => void;
  private currentSampleRate: number = PPG_CONFIG.sampleRate; // Track current sampleRate
  private isResetting: boolean = false; // Flag to prevent race conditions during reset

  constructor(options: AnalyzerOptions) {
    this.onMetrics = options.onMetrics;
    this.onStateChange = options.onStateChange;
    this.onFpsUpdate = options.onFpsUpdate;
  }

  getState(): PPGState {
    return this.state;
  }

  updateSampleRate(fps: number): void {
    // Calculate EMA (Exponential Moving Average) for stable sampleRate
    const alpha = 0.1; // Smoothing factor
    const smoothedFps = this.currentSampleRate * (1 - alpha) + fps * alpha;
    
    // Only update if significant change (>5% difference)
    const changePercent = Math.abs(smoothedFps - this.currentSampleRate) / this.currentSampleRate;
    if (changePercent > 0.05) {
      console.log('[PPGAnalyzer] SampleRate update', {
        oldRate: this.currentSampleRate.toFixed(1),
        newRate: smoothedFps.toFixed(1),
        rawFps: fps.toFixed(1),
        changePercent: (changePercent * 100).toFixed(1) + '%',
      });
      
      this.currentSampleRate = smoothedFps;
      
      // Notify parent component
      if (this.onFpsUpdate) {
        this.onFpsUpdate(smoothedFps);
      }
    }
  }

  async start(): Promise<void> {
    console.log('[PPGAnalyzer] Start requested, current state:', this.state);
    if (this.state !== 'idle') {
      console.log('[PPGAnalyzer] Not idle, ignoring start request');
      return;
    }

    try {
      this.setState('starting');
      console.log('[PPGAnalyzer] Creating HeartPy wrapper...');
      await this.wrapper.create(PPG_CONFIG.sampleRate);
      this.wrapper.setBufferRef(this.buffer); // Set buffer reference for peak filtering
      console.log('[PPGAnalyzer] HeartPy wrapper created successfully');

      this.setState('running');
      console.log('[PPGAnalyzer] Starting timer with interval:', PPG_CONFIG.uiUpdateIntervalMs);
      
      // Reset sample counter on start
      this.sampleCount = 0;
      this.totalPushed = 0;
      this.lastFlushTimestampMs = 0;
      
      this.timer = setInterval(() => {
        this.tick().catch((error) => {
          console.error('[PPGAnalyzer] Tick error:', error);
        });
      }, PPG_CONFIG.uiUpdateIntervalMs);
      console.log('[PPGAnalyzer] Started successfully');
    } catch (error) {
      console.error('[PPGAnalyzer] Start failed:', error);
      this.setState('idle');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }

    // FIXED: Atomic state transition to prevent race conditions
    if (this.state !== 'stopping') {
      this.setState('stopping');
    }

    // FIXED: Clear timer first to prevent race conditions
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[PPGAnalyzer] Timer cleared successfully');
    }

    try {
      await this.wrapper.destroy();
      console.log('[PPGAnalyzer] Wrapper destroyed successfully');
    } catch (error) {
      console.warn('[PPGAnalyzer] Wrapper destroy failed (may already be destroyed):', error);
    }

    // FIXED: Clear all data atomically
    this.pending.length = 0;
    this.pendingTimestamps.length = 0;
    this.buffer.clear();
    this.totalPushed = 0;
    this.lastFlushTimestampMs = 0;
    this.sampleCount = 0;

    this.setState('idle');
    console.log('[PPGAnalyzer] Stop completed successfully');
  }

  async addSample(sample: PPGSample): Promise<void> {
    // CRITICAL: Only accept samples when running to prevent race condition during stop
    if (this.state !== 'running') {
      console.warn('[PPGAnalyzer] Sample received while not running, dropping', {
        state: this.state,
        sampleValue: sample.value,
        sampleTimestamp: sample.timestamp,
      });
      return;
    }
    
    // CRITICAL: Check if reset is in progress
    if (this.isResetting) {
      console.warn('[PPGAnalyzer] Sample received during reset, dropping', {
        sampleValue: sample.value,
        sampleTimestamp: sample.timestamp,
      });
      return;
    }
    
    // CRITICAL: Check poor signal conditions BEFORE pushing to prevent self-comparison
    const resetTriggered = await this.checkPoorSignalConditions(sample);
    if (resetTriggered) {
      return;
    }
    
    // Update camera confidence in HeartPyWrapper for fallback
    if (sample.confidence !== undefined && this.wrapper) {
      this.wrapper.updateCameraConfidence(sample.confidence);
    }
    
    this.buffer.push(sample.value);
    this.pending.push(sample.value);
    this.pendingTimestamps.push(sample.timestamp);
    if (this.pending.length > PPG_CONFIG.ringBufferSize) {
      this.pending.splice(
        0,
        this.pending.length - PPG_CONFIG.ringBufferSize,
      );
      this.pendingTimestamps.splice(
        0,
        this.pendingTimestamps.length - PPG_CONFIG.ringBufferSize,
      );
    }
    
    // Increment sample counter for accurate throttling
    this.sampleCount++;
    
    // THROTTLED LOG: Use sample counter for accurate N-th sample logging
    if (PPG_CONFIG.debug.enabled && this.sampleCount % PPG_CONFIG.debug.sampleLogThrottle === 0) {
      console.log('[PPGAnalyzer] Sample received', {
        sampleCount: this.sampleCount,
        value: sample.value,
        timestamp: sample.timestamp,
        state: this.state,
        bufferSize: this.buffer.getSize(),
        pendingSize: this.pending.length,
      });
    }
  }

  private async checkPoorSignalConditions(sample: PPGSample): Promise<boolean> {
    // Check for poor signal conditions that require reset
    // Note: Camera confidence is always ~0.85, so we'll rely on metrics-based detection instead
    const shouldReset = 
      (this.pendingTimestamps.length > 0 && 
       sample.timestamp - this.pendingTimestamps[this.pendingTimestamps.length - 1] > 1.0); // Gap > 1s
    
    if (shouldReset) {
      console.log('[PPGAnalyzer] Poor signal detected (timestamp gap), resetting buffers', {
        timestampGap: this.pendingTimestamps.length > 0 ? 
          sample.timestamp - this.pendingTimestamps[this.pendingTimestamps.length - 1] : 'N/A',
      });
      
      // ATOMIC RESET: Set flag to prevent race conditions
      if (this.isResetting) {
        console.log('[PPGAnalyzer] Reset already in progress, skipping');
        return true;
      }
      
      this.isResetting = true;
      
      try {
        // Reset all buffers first
        this.buffer.clear();
        this.pending.length = 0;
        this.pendingTimestamps.length = 0;
        this.sampleCount = 0;
        this.totalPushed = 0;
        this.lastFlushTimestampMs = 0;
        
        // Reset HeartPy wrapper atomically
        if (this.wrapper) {
          await this.wrapper.reset();
        }
        
        console.log('[PPGAnalyzer] Atomic reset completed successfully');
      } catch (error) {
        console.error('[PPGAnalyzer] Atomic reset failed:', error);
        // Reset failed, but we still cleared buffers to prevent corruption
      } finally {
        this.isResetting = false;
      }
      
      return true;
    }
    return false;
  }

  private async tick(): Promise<void> {
    // CRITICAL: State check to prevent race condition during stop
    if (this.state !== 'running') {
      console.log('[PPGAnalyzer] Tick called while not running, clearing pending data', {
        state: this.state,
        pendingSamples: this.pending.length,
        pendingTimestamps: this.pendingTimestamps.length,
      });
      // Clear pending data to prevent stale samples from being processed
      this.pending.length = 0;
      this.pendingTimestamps.length = 0;
      return;
    }

    // CRITICAL: Skip tick if reset is in progress
    if (this.isResetting) {
      console.log('[PPGAnalyzer] Tick called during reset, skipping');
      return;
    }

    try {
      const nowMs = Date.now();
      const shouldFlush = this.pending.length >= PPG_CONFIG.microBatchSamples ||
        (this.pending.length > 0 && (nowMs - this.lastFlushTimestampMs) >= PPG_CONFIG.microBatchLatencyMs);

      if (shouldFlush) {
        await this.flushPending(nowMs);
      }

      const minSamplesBeforePoll = Math.floor(PPG_CONFIG.minSamplesBeforePollSec * this.currentSampleRate);
      if (this.totalPushed < minSamplesBeforePoll) {
        if (PPG_CONFIG.debug.enabled) {
          console.log('[PPGAnalyzer] Warm-up gate', {
            totalPushed: this.totalPushed,
            required: minSamplesBeforePoll,
          });
        }
        return;
      }

      const metrics = await this.wrapper.poll();
      if (metrics) {
        const hasResult = metrics.hasResult === true;
        const snrDb = metrics.snrDb ?? -10;
        const goodQuality = metrics.quality?.goodQuality ?? false;
        const rejectionRate = metrics.quality?.rejectionRate ?? 0;
        const q = goodQuality ? 1 : 0;
        const snrScore = Math.min(1, Math.max(0, (snrDb - PPG_CONFIG.snrDbThresholdUI) / 12));
        const rejectionScore = Math.min(1, Math.max(0, 1 - rejectionRate));
        const reliability = Math.min(1, Math.max(0, 0.6 * q + 0.3 * snrScore + 0.1 * rejectionScore));

        const enrichedMetrics = {
          ...metrics,
          hasResult,
          confidence: reliability,
          quality: {
            ...metrics.quality,
            rejectionRate,
          },
        };

        console.log('[PPGAnalyzer] Metrics polled', {
          bpm: enrichedMetrics.bpm,
          reliability: reliability,
          snrDb,
          hasResult,
        });
        this.onMetrics(enrichedMetrics, this.buffer.getAll());
      }
    } catch (error) {
      console.warn('[PPGAnalyzer] tick error', error);
      // Don't call stop() again to prevent recursive stop calls
      if (error instanceof Error && error.message.includes('destroyed')) {
        console.log('[PPGAnalyzer] RealtimeAnalyzer destroyed, clearing state');
        this.pending.length = 0;
        this.pendingTimestamps.length = 0;
        this.setState('idle');
      }
    }
  }

  private async flushPending(nowMs: number): Promise<void> {
    if (this.pending.length === 0) return;
    console.log('[PPGAnalyzer] Flushing pending samples', {
      pending: this.pending.length,
    });
    const samples = this.pending.splice(0);
    const timestamps = this.pendingTimestamps.splice(0);

    if (samples.length !== timestamps.length) {
      console.error('[PPGAnalyzer] Length mismatch detected', {
        samplesLength: samples.length,
        timestampsLength: timestamps.length,
      });
      this.pending.length = 0;
      this.pendingTimestamps.length = 0;
      return;
    }

    console.log('[PPGAnalyzer] Using real timestamps', {
      sampleCount: samples.length,
      timestampCount: timestamps.length,
      firstTimestamp: timestamps[0],
      lastTimestamp: timestamps[timestamps.length - 1],
    });

    await this.wrapper.pushWithTimestamps(samples, timestamps);
    this.totalPushed += samples.length;
    this.lastFlushTimestampMs = nowMs;
  }

  private setState(next: PPGState): void {
    if (this.state === next) {
      return;
    }
    console.log('[PPGAnalyzer] State transition', {from: this.state, to: next});
    this.state = next;
    this.onStateChange?.(next);
  }
}
