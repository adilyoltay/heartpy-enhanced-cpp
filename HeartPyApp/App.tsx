import React, {useCallback, useEffect, useRef, useState} from 'react';
import {SafeAreaView, ScrollView, StatusBar, StyleSheet, View} from 'react-native';
import {PPGCamera} from './src/components/PPGCamera';
import {PPGDisplay} from './src/components/PPGDisplay';
import {PPGParameterControls} from './src/components/PPGParameterControls';
import {PPGAnalyzer, DEFAULT_ANALYZER_OPTIONS, type AnalyzerTuningOptions} from './src/core/PPGAnalyzer';
import {PPG_CONFIG} from './src/core/PPGConfig';
import type {
  PPGSample,
  PPGState,
  PPGAnalysisFrame,
} from './src/types/PPGTypes';

function useAnalyzer() {
  const analyzerRef = useRef<PPGAnalyzer | null>(null);
  const [analysisData, setAnalysisData] = useState<PPGAnalysisFrame>({
    metrics: null,
    waveform: [],
  });
  const [state, setState] = useState<PPGState>('idle');
  const [options, setOptions] = useState<AnalyzerTuningOptions>({...DEFAULT_ANALYZER_OPTIONS});

  useEffect(() => {
    console.log('[App] Initializing analyzer');
    analyzerRef.current = new PPGAnalyzer({
      onStateChange: nextState => {
        console.log('[App] Analyzer state changed', {nextState});
        setState(nextState);
      },
      onFrame: frame => {
        console.log('[App] Frame received', {
          bpm: frame.metrics?.bpm,
          waveformSamples: frame.waveform.length,
        });
        setAnalysisData(frame);
      },
      onHeartRateUpdate: update => {
        console.log('[App] Heart rate update', update);
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

    if (
      PPG_CONFIG.debug.enabled &&
      sampleCountRef.current % PPG_CONFIG.debug.sampleLogThrottle === 0
    ) {
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

  const updateOptions = useCallback(async (partial: Partial<AnalyzerTuningOptions>) => {
    const entries = Object.entries(partial).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }

    const sanitized = Object.fromEntries(entries) as Partial<AnalyzerTuningOptions>;

    setOptions(prev => ({
      ...prev,
      ...sanitized,
    }));

    try {
      await analyzerRef.current?.configure(sanitized);
    } catch (error) {
      console.error('[App] Failed to apply analyzer options', error);
    }
  }, []);

  const resetOptions = useCallback(async () => {
    const defaults = {...DEFAULT_ANALYZER_OPTIONS};
    setOptions(defaults);
    try {
      await analyzerRef.current?.resetOptions();
    } catch (error) {
      console.error('[App] Failed to reset analyzer options', error);
    }
  }, []);

  const snrMetrics = analyzerRef.current?.getSnrMetrics();

  return {
    analysisData,
    state,
    start,
    stop,
    addSample,
    updateSampleRate,
    options,
    updateOptions,
    resetOptions,
    snrMetrics
  };
}

function App(): React.JSX.Element {
  const {analysisData, state, start, stop, addSample, updateSampleRate, options, updateOptions, resetOptions, snrMetrics} = useAnalyzer();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <PPGDisplay
          data={analysisData}
          state={state}
          onStart={start}
          onStop={stop}
          snrMetrics={snrMetrics}
        />
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelScrollContent}
          keyboardShouldPersistTaps="handled">
          <PPGParameterControls
            options={options}
            onChange={updateOptions}
            onReset={resetOptions}
            disabled={state === 'starting'}
          />
        </ScrollView>
      </View>
      <View style={styles.hiddenCameraWrapper} pointerEvents="none">
        <PPGCamera
          hidden
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
  panelScroll: {
    flexGrow: 0,
    maxHeight: 280,
  },
  panelScrollContent: {
    paddingBottom: 16,
  },
  hiddenCameraWrapper: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: -100,
    left: -100,
  },
});

export default App;
