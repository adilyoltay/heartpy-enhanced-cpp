import {RealtimeAnalyzer} from 'react-native-heartpy';
import type {PPGMetrics} from '../types/PPGTypes';

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

    // HeartPy doesn't provide confidence/snrDb directly, calculate from available data
    const quality = result.quality ?? {};
    const goodQuality = quality.goodQuality === true;
    const totalBeats =
      typeof quality.totalBeats === 'number' ? quality.totalBeats : 0;
    const rejectionRate =
      typeof quality.rejectionRate === 'number' ? quality.rejectionRate : 1;

    // HeartPy provides confidence and snrDb directly in quality
    const confidence = typeof quality.confidence === 'number' ? quality.confidence : 
      (goodQuality ? Math.max(0.7, 1 - rejectionRate) : Math.min(0.3, 1 - rejectionRate));
    
    const snrDb = typeof quality.snrDb === 'number' ? quality.snrDb : 
      (goodQuality && totalPower > 0 ? Math.log10(Math.max(hf + lf, 0.01) / Math.max(totalPower - hf - lf, 0.01)) * 10 : -10);

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
