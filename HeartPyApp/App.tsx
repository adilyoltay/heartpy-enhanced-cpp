import React, {useCallback, useEffect, useRef, useState} from 'react';
import {SafeAreaView, StatusBar, StyleSheet, View} from 'react-native';
import {PPGCamera} from './src/components/PPGCamera';
import {PPGDisplay} from './src/components/PPGDisplay';
import {PPGAnalyzer} from './src/core/PPGAnalyzer';
import {PPG_CONFIG} from './src/core/PPGConfig';
import type {PPGMetrics, PPGSample, PPGState} from './src/types/PPGTypes';

function useAnalyzer() {
  const analyzerRef = useRef<PPGAnalyzer | null>(null);
  const [metrics, setMetrics] = useState<PPGMetrics | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [state, setState] = useState<PPGState>('idle');

  useEffect(() => {
    console.log('[App] Initializing analyzer');
    analyzerRef.current = new PPGAnalyzer({
      onMetrics: (nextMetrics, nextWaveform) => {
        console.log('[App] Metrics received', {
          bpm: nextMetrics?.bpm,
          confidence: nextMetrics?.confidence,
          snrDb: nextMetrics?.snrDb,
          waveformSamples: nextWaveform.length,
        });
        setMetrics(nextMetrics);
        setWaveform(nextWaveform);
      },
      onStateChange: (nextState) => {
        console.log('[App] Analyzer state changed', {nextState});
        setState(nextState);
      },
      onFpsUpdate: (fps) => {
        console.log('[App] FPS updated', {fps: fps.toFixed(1)});
        // Note: FPS is tracked but not displayed in UI yet
        // Could be added to metrics display if needed
      },
    });
    return () => {
      console.log('[App] Cleaning up analyzer');
      analyzerRef.current?.stop().catch(console.warn);
      analyzerRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    console.log('[App] Start button pressed, current state:', state);
    try {
      await analyzerRef.current?.start();
      console.log('[App] Start completed successfully');
    } catch (error) {
      console.error('[App] Start failed:', error);
    }
  }, [state]);

  const stop = useCallback(async () => {
    console.log('[App] Stop requested, current state:', state);
    await analyzerRef.current?.stop();
    console.log('[App] Stop completed');
  }, [state]);

  const sampleCountRef = useRef(0);
  const addSample = useCallback(async (sample: PPGSample) => {
    sampleCountRef.current += 1;
    
    // THROTTLED LOG: Only log every Nth sample when debug enabled
    if (PPG_CONFIG.debug.enabled && sampleCountRef.current % PPG_CONFIG.debug.sampleLogThrottle === 0) {
      console.log('[App] Sample received', {
        count: sampleCountRef.current,
        value: sample.value,
        timestamp: sample.timestamp,
        state: state,
      });
    }
    
    try {
      await analyzerRef.current?.addSample(sample);
    } catch (error) {
      console.warn('[App] Sample processing failed:', error);
    }
  }, [state]);

  const updateSampleRate = useCallback((fps: number) => {
    analyzerRef.current?.updateSampleRate(fps);
  }, []);

  return {metrics, waveform, state, start, stop, addSample, updateSampleRate};
}

function App(): React.JSX.Element {
  const {metrics, waveform, state, start, stop, addSample, updateSampleRate} = useAnalyzer();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <PPGDisplay
          metrics={metrics}
          waveform={waveform}
          state={state}
          onStart={start}
          onStop={stop}
        />
        <PPGCamera 
          onSample={addSample} 
          isActive={state !== 'idle'} 
          onFpsUpdate={updateSampleRate}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    padding: 16,
    gap: 24,
    backgroundColor: '#000',
  },
});

export default App;
