import type {HeartPyConfig, NativePollResult} from '../core/PPGTypes';

interface FixturePayload {
  readonly sampleRate: number;
  readonly pollResults: readonly NativePollResult[];
}

/**
 * Tiny in-memory substitute for the native HeartPy bridge so we can drive
 * {@link PPGEngine} in tests without loading the actual C++ module.
 */
export class FakeHeartPyWrapper {
  private created = false;
  private pollCursor = 0;
  private lastPushCount = 0;

  constructor(private readonly payload: FixturePayload) {}

  async create(fs: number, _config: HeartPyConfig): Promise<void> {
    if (this.created) {
      return;
    }
    if (fs !== this.payload.sampleRate) {
      throw new Error(
        `Unexpected sample rate ${fs}; expected ${this.payload.sampleRate}`,
      );
    }
    this.created = true;
    this.pollCursor = 0;
    this.lastPushCount = 0;
  }

  async push(samples: Float32Array): Promise<void> {
    this.ensureCreated();
    this.lastPushCount = samples.length;
  }

  async pushWithTimestamps(
    samples: Float32Array,
    _timestamps: Float64Array,
  ): Promise<void> {
    this.ensureCreated();
    this.lastPushCount = samples.length;
  }

  async poll(): Promise<NativePollResult> {
    this.ensureCreated();
    if (this.lastPushCount === 0) {
      // Mirror native behaviour: when nothing was pushed we return the last result.
      return this.payload.pollResults[
        Math.min(this.pollCursor, this.payload.pollResults.length - 1)
      ];
    }
    const result =
      this.payload.pollResults[
        Math.min(this.pollCursor, this.payload.pollResults.length - 1)
      ];
    if (this.pollCursor < this.payload.pollResults.length - 1) {
      this.pollCursor += 1;
    }
    this.lastPushCount = 0;
    return result;
  }

  async destroy(): Promise<void> {
    this.created = false;
    this.pollCursor = 0;
    this.lastPushCount = 0;
  }

  private ensureCreated(): void {
    if (!this.created) {
      throw new Error('FakeHeartPyWrapper used before create()');
    }
  }
}
