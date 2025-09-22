import {HeartPyWrapper} from './HeartPyWrapper';
import {RingBuffer} from './RingBuffer';
import type {
  PPGAnalysisFrame,
  PPGHeartRateUpdate,
  PPGSample,
  PPGState,
} from '../types/PPGTypes';
import {PPG_CONFIG} from './PPGConfig';


export type AnalyzerTuningOptions = {
  pHalfOverFundThresholdSoft: number;
  refractoryMs: number;
  thresholdScale: number;
  welchWsizeSec?: number;
  nfft?: number;
  lowCutoffHz?: number;
  highCutoffHz?: number;
  removeBaselineWander?: boolean;
  snrTauSec?: number;
  snrActiveTauSec?: number;
  adaptivePsd?: boolean;
  calcFreq?: boolean;
  thresholdRR?: boolean;
  filterMode?: 'auto' | 'rbj' | 'butter' | 'butter-filtfilt';
  filterOrder?: number;
};

export const DEFAULT_ANALYZER_OPTIONS: AnalyzerTuningOptions = {
  pHalfOverFundThresholdSoft: 1.2,
  refractoryMs: 280.0,
  thresholdScale: 0.5,
  welchWsizeSec: 8.0,
  nfft: 1024,
  highCutoffHz: 2.5,
  removeBaselineWander: true,
  snrTauSec: 1.0,
  snrActiveTauSec: 1.0,
  adaptivePsd: true,
  calcFreq: PPG_CONFIG.calcFreqEnabled,
  thresholdRR: PPG_CONFIG.thresholdRR,
  filterMode: PPG_CONFIG.filterMode,
  filterOrder: PPG_CONFIG.filterOrder,
};

type AnalyzerOptions = {
  onStateChange: (state: PPGState) => void;
  onFrame: (frame: PPGAnalysisFrame) => void;
  onHeartRateUpdate: (update: PPGHeartRateUpdate) => void;
};

type PendingSample = {value: number; timestampMs: number};

// Note: This class is not designed to be thread-safe.
// All public methods should be called from the same thread (the JS thread).
export class PPGAnalyzer {
  private readonly onStateChangeCb: (state: PPGState) => void;
  private readonly onFrameCb: (frame: PPGAnalysisFrame) => void;
  private readonly onHeartRateUpdateCb: (update: PPGHeartRateUpdate) => void;

  private state: PPGState = 'idle';
  private wrapper: HeartPyWrapper | null = null;
  private sampleRate: number = PPG_CONFIG.sampleRate;
  private tuningOptions: AnalyzerTuningOptions = {...DEFAULT_ANALYZER_OPTIONS};
  private restartPromise: Promise<void> | null = null;
  private shouldAutoRestart = false;

  private pendingSamples: PendingSample[] = [];
  private readonly sampleBuffer = new RingBuffer<PPGSample>(PPG_CONFIG.ringBufferSize);
  private timerId: NodeJS.Timeout | null = null;
  private totalSamplesPushed = 0;
  private reservoirReady = false;
  private hasLoggedReservoirWait = false;

  constructor(options: AnalyzerOptions) {
    this.onStateChangeCb = options.onStateChange;
    this.onFrameCb = options.onFrame;
    this.onHeartRateUpdateCb = options.onHeartRateUpdate;
  }

  public getOptions(): AnalyzerTuningOptions {
    return {...this.tuningOptions};
  }

  public async configure(partial: Partial<AnalyzerTuningOptions>): Promise<void> {
    const sanitizedEntries = Object.entries(partial).filter(([, value]) => value !== undefined);
    if (sanitizedEntries.length === 0) {
      return;
    }

    const sanitized = Object.fromEntries(sanitizedEntries) as Partial<AnalyzerTuningOptions>;
    this.tuningOptions = {...this.tuningOptions, ...sanitized};

    if (this.state === 'running') {
      await this.restart();
    }
  }

  public async resetOptions(): Promise<void> {
    this.tuningOptions = {...DEFAULT_ANALYZER_OPTIONS};
    if (this.state === 'running') {
      await this.restart();
    }
  }

  private buildWrapperOptions(): Partial<AnalyzerTuningOptions> {
    return Object.fromEntries(
      Object.entries(this.tuningOptions).filter(([, value]) => value !== undefined),
    ) as Partial<AnalyzerTuningOptions>;
  }

  private async initializeWrapper(): Promise<void> {
    const wrapper = new HeartPyWrapper();
    const snrTauSec = this.tuningOptions.snrTauSec ?? DEFAULT_ANALYZER_OPTIONS.snrTauSec ?? 1.0;
    const snrActiveTauSec =
      this.tuningOptions.snrActiveTauSec ?? DEFAULT_ANALYZER_OPTIONS.snrActiveTauSec ?? 1.0;

    const createOptions = {
      // Known-good peak detection parameters
      pHalfOverFundThresholdSoft: 1.2,
      refractoryMs: 350.0, // DEĞİŞİKLİK: 280.0 -> 350.0
      thresholdScale: 0.5,
      minPeakDistanceMs: PPG_CONFIG.peakMinSpacingMs,
      rrOutlierPercent: PPG_CONFIG.rrOutlierPercent,
      rrOutlierMinMs: PPG_CONFIG.rrOutlierMinMs,
      rrOutlierMaxMs: PPG_CONFIG.rrOutlierMaxMs,

      // Relaxed bandpass for richer signal
      highCutoffHz: 3.5,
      removeBaselineWander: false,

      // Keep the responsive SNR smoothing
      snrTauSec,
      snrActiveTauSec,
      calcFreq: this.tuningOptions.calcFreq ?? PPG_CONFIG.calcFreqEnabled,
      windowSeconds: PPG_CONFIG.analysisWindow / this.sampleRate, // YENİ EKLENDİ
      adaptivePsd: PPG_CONFIG.debug.enableAdaptivePsd ?? true,
      thresholdRR:
        this.tuningOptions.thresholdRR ?? PPG_CONFIG.thresholdRR ?? false,
      filter: {
        mode: this.tuningOptions.filterMode ?? PPG_CONFIG.filterMode ?? 'auto',
        order: this.tuningOptions.filterOrder ?? PPG_CONFIG.filterOrder ?? 2,
      },
    } as const;

    console.log('[PPGAnalyzer] Initializing HeartPyWrapper', {
      sampleRate: this.sampleRate,
      options: createOptions,
    });

    await wrapper.create(this.sampleRate, createOptions);
    wrapper.setBufferRef(this.sampleBuffer);
    this.wrapper = wrapper;
  }

  private async restart(): Promise<void> {
    if (this.restartPromise) {
      await this.restartPromise;
      return;
    }

    this.restartPromise = (async () => {
      this.shouldAutoRestart = true;
      await this.performStop();
      if (this.shouldAutoRestart) {
        await this.start();
      }
    })();

    try {
      await this.restartPromise;
    } finally {
      this.shouldAutoRestart = false;
      this.restartPromise = null;
    }
  }

  private setState(nextState: PPGState) {
    if (this.state === nextState) {
      return;
    }
    this.state = nextState;
    this.onStateChangeCb(nextState);
  }

  public addSample(sample: PPGSample) {
    if (this.state !== 'running') {
      return;
    }
    this.sampleBuffer.push(sample);
    // Convert to integer milliseconds at the earliest possible moment
    this.pendingSamples.push({
      value: sample.value,
      timestampMs: Math.round(sample.timestamp * 1000),
    });
  }

  public async start() {
    if (this.state !== 'idle') {
      return;
    }
    this.setState('starting');

    try {
      const effectiveSampleRate =
        Number.isFinite(this.sampleRate) &&
        this.sampleRate >= 1 &&
        this.sampleRate <= 10_000
          ? this.sampleRate
          : PPG_CONFIG.sampleRate;

      this.sampleRate = effectiveSampleRate;

      this.totalSamplesPushed = 0;
      this.reservoirReady = false;
      this.hasLoggedReservoirWait = false;
      this.sampleBuffer.clear();

      await this.initializeWrapper();

      this.timerId = setInterval(
        () => this.tick(),
        PPG_CONFIG.uiUpdateIntervalMs,
      );

      this.setState('running');
      console.log('[PPGAnalyzer] Started successfully');
    } catch (e) {
      console.error('[PPGAnalyzer] Failed to start', e);
      this.setState('idle');
    }
  }

  private async performStop(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.wrapper) {
      try {
        await this.wrapper.destroy();
      } catch (error) {
        console.warn('[PPGAnalyzer] Failed to destroy wrapper during stop', error);
      }
    }
    this.wrapper = null;
    this.pendingSamples = [];
    this.totalSamplesPushed = 0;
    this.reservoirReady = false;
    this.hasLoggedReservoirWait = false;
    this.sampleBuffer.clear();
    this.setState('idle');
    console.log('[PPGAnalyzer] Stopped');
  }

  public async stop(): Promise<void> {
    this.shouldAutoRestart = false;
    await this.performStop();
  }

  private async tick() {
    if (this.state !== 'running' || !this.wrapper) {
      return;
    }

    // 1. Flush pending samples to C++ when we have a meaningful batch ready
    const BATCH_SIZE = 30; // ≈1 second of data at 30 FPS sample cadence

    if (this.pendingSamples.length < BATCH_SIZE) {
      // Not enough signal yet—wait until we can ship a full batch downstream
      return;
    }

    const samplesToProcess = this.pendingSamples.splice(0, BATCH_SIZE); // Only forward a full batch
    const values = samplesToProcess.map(s => s.value);
    const timestamps = samplesToProcess.map(s => s.timestampMs / 1000.0);
    await this.wrapper.pushWithTimestamps(values, timestamps);

    this.totalSamplesPushed += values.length;

    if (!this.reservoirReady) {
      const reservoirSamplesRequired = Math.max(
        PPG_CONFIG.analysisWindow,
        Math.ceil(PPG_CONFIG.minSamplesBeforePollSec * this.sampleRate),
      );

      if (this.totalSamplesPushed < reservoirSamplesRequired) {
        if (!this.hasLoggedReservoirWait && PPG_CONFIG.debug.enabled) {
          console.log('[PPGAnalyzer] Waiting for reservoir warm-up', {
            pushedSamples: this.totalSamplesPushed,
            reservoirSamplesRequired,
          });
        }
        this.hasLoggedReservoirWait = true;
        return;
      }

      this.reservoirReady = true;
      this.hasLoggedReservoirWait = false;
      if (PPG_CONFIG.debug.enabled) {
        console.log('[PPGAnalyzer] Reservoir ready; enabling native polling', {
          pushedSamples: this.totalSamplesPushed,
        });
      }
    }

    // 2. Poll for a new analysis frame (after successfully pushing a full batch)
    const analysisResult = await this.wrapper.poll();

    // 3. If a new, complete frame is returned, pass it to the UI
    if (analysisResult && analysisResult.metrics) {
      // The result from C++ is the new source of truth.
      // It contains the metrics AND the exact waveform snapshot used for the analysis.
      const {
        metrics,
        waveform_values = [],
        waveform_timestamps = [],
      } = analysisResult;

      // Combine the synchronized waveform data into the format the UI expects
      const sampleCount = Math.min(
        waveform_values.length,
        waveform_timestamps.length,
      );

      const waveformSnapshot = Array.from({length: sampleCount}, (_, index) => ({
        value: waveform_values[index],
        timestamp: Math.round(waveform_timestamps[index] * 1000),
      }));

      const newFrame: PPGAnalysisFrame = {
        metrics,
        waveform: waveformSnapshot,
      };

      this.onFrameCb(newFrame);

      if (metrics.bpm) {
        this.onHeartRateUpdateCb({
          bpm: metrics.bpm,
          confidence: metrics.confidence ?? metrics.quality?.confidence ?? 0,
        });
      }
    }
  }

  public updateSampleRate(fps: number) {
    if (!Number.isFinite(fps) || fps <= 0) {
      return;
    }
    const clamped = Math.max(1, Math.min(10_000, fps));
    if (clamped === this.sampleRate) {
      return;
    }
    this.sampleRate = clamped;
  }

  public getSnrMetrics() {
    return this.wrapper?.getSnrMetrics();
  }
}
