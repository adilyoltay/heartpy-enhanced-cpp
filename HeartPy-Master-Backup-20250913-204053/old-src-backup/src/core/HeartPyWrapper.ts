import { NativeModules } from 'react-native';
import type {
  HeartPyHandle,
  HeartPyNativeModule,
  NativePollResult,
  PPGError,
} from '../types/PPGTypes';

class HeartPyFailure extends Error {
  constructor(readonly code: PPGError, message: string) {
    super(message);
  }
}

function requireModule(): HeartPyNativeModule {
  const moduleRef = NativeModules?.HeartPyModule as HeartPyNativeModule | undefined;
  if (!moduleRef) {
    throw new HeartPyFailure('config', 'HeartPy native module not linked');
  }
  return moduleRef;
}

function cloneSamples(samples: Float32Array): Float32Array {
  return new Float32Array(samples);
}

export class HeartPyWrapper {
  private handle: HeartPyHandle | null = null;

  constructor(private readonly nativeModule: HeartPyNativeModule = requireModule()) {}

  async create(sampleRate: number): Promise<void> {
    if (this.handle !== null) {
      return;
    }
    try {
      this.handle = await this.nativeModule.create(sampleRate);
    } catch (error) {
      throw new HeartPyFailure('native', `HeartPy create failed: ${String(error)}`);
    }
  }

  async push(samples: Float32Array): Promise<void> {
    if (this.handle === null) {
      throw new HeartPyFailure('config', 'HeartPy not initialized');
    }
    try {
      await this.nativeModule.push(this.handle, cloneSamples(samples));
    } catch (error) {
      throw new HeartPyFailure('native', `HeartPy push failed: ${String(error)}`);
    }
  }

  async poll(): Promise<NativePollResult | null> {
    if (this.handle === null) {
      throw new HeartPyFailure('config', 'HeartPy not initialized');
    }
    try {
      return await this.nativeModule.poll(this.handle);
    } catch (error) {
      throw new HeartPyFailure('native', `HeartPy poll failed: ${String(error)}`);
    }
  }

  async destroy(): Promise<void> {
    if (this.handle === null) {
      return;
    }
    try {
      await this.nativeModule.destroy(this.handle);
    } catch (error) {
      throw new HeartPyFailure('native', `HeartPy destroy failed: ${String(error)}`);
    } finally {
      this.handle = null;
    }
  }
}
