import { PPG_CONFIG } from './PPGConfig';
import { HeartPyWrapper } from './HeartPyWrapper';
import { RingBuffer } from './RingBuffer';
import type {
  NativePollResult,
  PPGMetrics,
  PPGSample,
  PPGState,
} from '../types/PPGTypes';

export class PPGAnalyzer {
  private readonly buffer = new RingBuffer<PPGSample>(PPG_CONFIG.analysis.bufferSize);
  private readonly pending: PPGSample[] = [];
  private readonly wrapper: HeartPyWrapper;
  private timer: NodeJS.Timeout | null = null;
  private state: PPGState = 'idle';
  private metrics: PPGMetrics | null = null;
  private lastError: Error | null = null;
  private listener: ((metrics: PPGMetrics | null, state: PPGState) => void) | null = null;

  constructor(wrapper?: HeartPyWrapper) {
    this.wrapper = wrapper ?? new HeartPyWrapper();
  }

  subscribe(listener: (metrics: PPGMetrics | null, state: PPGState) => void): void {
    this.listener = listener;
    this.notify();
  }

  getState(): PPGState {
    return this.state;
  }

  getMetrics(): PPGMetrics | null {
    return this.metrics;
  }

  getWaveform(): readonly number[] {
    return this.buffer
      .getAll()
      .slice(-PPG_CONFIG.ui.waveformSamples)
      .map((sample) => sample.value);
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('Analyzer already started');
    }
    await this.wrapper.create(PPG_CONFIG.analysis.sampleRate);
    this.resetData();
    this.state = 'starting';
    this.notify();
    this.startTimer();
  }

  async stop(): Promise<void> {
    if (this.state === 'idle') {
      return;
    }
    this.state = 'stopping';
    this.notify();
    this.stopTimer();
    this.pending.length = 0;
    this.buffer.clear();
    this.metrics = null;
    await this.wrapper.destroy();
    this.state = 'idle';
    this.notify();
  }

  addSample(sample: PPGSample): void {
    if (this.state === 'idle' || this.state === 'stopping') {
      return;
    }
    this.buffer.push(sample);
    this.pending.push(sample);
  }

  private resetData(): void {
    this.buffer.clear();
    this.pending.length = 0;
    this.metrics = null;
    this.lastError = null;
  }

  private startTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, PPG_CONFIG.ui.updateInterval);
  }

  private stopTimer(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.state === 'stopping' || this.pending.length === 0) {
      return;
    }
    try {
      await this.flushPending();
      await this.retrieveMetrics();
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      await this.stop();
    }
  }

  private async flushPending(): Promise<void> {
    const values = new Float32Array(this.pending.length);
    for (let index = 0; index < this.pending.length; index += 1) {
      values[index] = this.pending[index].value;
    }
    this.pending.length = 0;
    await this.wrapper.push(values);
  }

  private async retrieveMetrics(): Promise<void> {
    const result = await this.wrapper.poll();
    if (!result) {
      return;
    }
    this.updateMetrics(result);
    if (this.state === 'starting') {
      this.state = 'running';
      this.notify();
    }
  }

  private updateMetrics(result: NativePollResult): void {
    this.metrics = {
      bpm: result.bpm,
      confidence: result.confidence,
      snr: result.snr,
      quality: result.quality.goodQuality ? 'good' : result.quality.qualityFlag,
    };
    this.notify();
  }

  private notify(): void {
    this.listener?.(this.metrics, this.state);
  }
}
