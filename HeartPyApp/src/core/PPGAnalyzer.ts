import type {PPGMetrics, PPGSample, PPGState} from '../types/PPGTypes';
import {PPG_CONFIG} from './PPGConfig';
import {HeartPyWrapper} from './HeartPyWrapper';
import {RingBuffer} from './RingBuffer';

interface AnalyzerOptions {
  onMetrics: (metrics: PPGMetrics, waveform: number[]) => void;
  onStateChange?: (state: PPGState) => void;
}

export class PPGAnalyzer {
  private state: PPGState = 'idle';
  private readonly wrapper = new HeartPyWrapper();
  private readonly buffer = new RingBuffer<number>(
    PPG_CONFIG.analysis.bufferSize,
  );
  private timer: NodeJS.Timeout | null = null;
  private readonly pending: number[] = [];
  private sampleCount = 0; // Sample counter for accurate throttling
  private readonly onMetrics: (metrics: PPGMetrics, waveform: number[]) => void;
  private readonly onStateChange?: (state: PPGState) => void;

  constructor(options: AnalyzerOptions) {
    this.onMetrics = options.onMetrics;
    this.onStateChange = options.onStateChange;
  }

  getState(): PPGState {
    return this.state;
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
      await this.wrapper.create(PPG_CONFIG.analysis.sampleRate);
      console.log('[PPGAnalyzer] HeartPy wrapper created successfully');

      this.setState('running');
      console.log('[PPGAnalyzer] Starting timer with interval:', PPG_CONFIG.ui.updateInterval);
      
      // Reset sample counter on start
      this.sampleCount = 0;
      
      this.timer = setInterval(() => {
        this.tick().catch((error) => {
          console.error('[PPGAnalyzer] Tick error:', error);
        });
      }, PPG_CONFIG.ui.updateInterval);
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
    this.setState('stopping');
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.wrapper.destroy();
    this.pending.length = 0;
    this.buffer.clear();
    this.setState('idle');
  }

  addSample(sample: PPGSample): void {
    if (this.state === 'idle') {
      console.warn('[PPGAnalyzer] Sample received while idle, dropping');
      return;
    }
    if (this.state === 'starting') {
      console.log('[PPGAnalyzer] Buffering sample during startup');
    }
    
    this.buffer.push(sample.value);
    this.pending.push(sample.value);
    if (this.pending.length > PPG_CONFIG.analysis.bufferSize) {
      this.pending.splice(
        0,
        this.pending.length - PPG_CONFIG.analysis.bufferSize,
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

  private async tick(): Promise<void> {
    try {
      if (this.pending.length > 0) {
        console.log('[PPGAnalyzer] Flushing pending samples', {
          pending: this.pending.length,
        });
        const chunk = new Float32Array(this.pending);
        this.pending.length = 0;
        await this.wrapper.push(chunk);
      }
      const metrics = await this.wrapper.poll();
      if (metrics) {
        console.log('[PPGAnalyzer] Metrics polled', {
          bpm: metrics.bpm,
          confidence: metrics.confidence,
          snrDb: metrics.snrDb,
        });
        this.onMetrics(metrics, this.buffer.getAll());
      }
    } catch (error) {
      console.warn('[PPGAnalyzer] tick error', error);
      await this.stop();
    }
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
