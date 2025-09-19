import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PPGCamera } from './components/PPGCamera';
import { PPGDisplay } from './components/PPGDisplay';
import { PPGAnalyzer } from './core/PPGAnalyzer';
import type { PPGMetrics, PPGSample, PPGState } from './types/PPGTypes';

type ControllerState = {
  readonly analyzerRef: React.MutableRefObject<PPGAnalyzer | null>;
  readonly lastErrorRef: React.MutableRefObject<Error | null>;
  readonly metrics: PPGMetrics | null;
  readonly setMetrics: React.Dispatch<React.SetStateAction<PPGMetrics | null>>;
  readonly state: PPGState;
  readonly setState: React.Dispatch<React.SetStateAction<PPGState>>;
  readonly waveform: readonly number[];
  readonly setWaveform: React.Dispatch<React.SetStateAction<readonly number[]>>;
  readonly error: Error | null;
  readonly setError: React.Dispatch<React.SetStateAction<Error | null>>;
};

interface AnalyzerUpdateContext {
  readonly analyzer: PPGAnalyzer;
  readonly metrics: PPGMetrics | null;
  readonly analyzerState: PPGState;
  readonly lastErrorRef: React.MutableRefObject<Error | null>;
  readonly setMetrics: React.Dispatch<React.SetStateAction<PPGMetrics | null>>;
  readonly setState: React.Dispatch<React.SetStateAction<PPGState>>;
  readonly setWaveform: React.Dispatch<React.SetStateAction<readonly number[]>>;
  readonly setError: React.Dispatch<React.SetStateAction<Error | null>>;
}

export default function App(): JSX.Element {
  const controller = useAnalyzerController();
  return (
    <View style={styles.container}>
      <View style={styles.cameraArea}>
        {controller.isCameraActive ? <PPGCamera onSample={controller.onSample} /> : <IdlePlaceholder />}
      </View>
      <PPGDisplay
        metrics={controller.metrics}
        state={controller.state}
        waveform={controller.waveform}
        onStart={controller.onStart}
        onStop={controller.onStop}
      />
    </View>
  );
}

function useAnalyzerController() {
  const state = useControllerState();
  const onSample = useSampleHandler(state.analyzerRef);
  const onStart = useStartHandler(state.analyzerRef, state.setError);
  const onStop = useStopHandler(state.analyzerRef, state.setError);
  useAnalyzerLifecycle(state);
  useErrorAlerts(state.error);
  const isCameraActive = state.state === 'running' || state.state === 'starting';
  return {
    metrics: state.metrics,
    state: state.state,
    waveform: state.waveform,
    onSample,
    onStart,
    onStop,
    isCameraActive,
  } as const;
}

function useControllerState(): ControllerState {
  const analyzerRef = useRef<PPGAnalyzer | null>(null);
  const lastErrorRef = useRef<Error | null>(null);
  const [metrics, setMetrics] = useState<PPGMetrics | null>(null);
  const [state, setState] = useState<PPGState>('idle');
  const [waveform, setWaveform] = useState<readonly number[]>([]);
  const [error, setError] = useState<Error | null>(null);
  return { analyzerRef, lastErrorRef, metrics, setMetrics, state, setState, waveform, setWaveform, error, setError };
}

function useAnalyzerLifecycle(state: ControllerState): void {
  const { analyzerRef, lastErrorRef, setMetrics, setState, setWaveform, setError } = state;
  useEffect(() => {
    const analyzer = new PPGAnalyzer();
    analyzerRef.current = analyzer;
    analyzer.subscribe((metrics, analyzerState) => {
      handleAnalyzerUpdate({ analyzer, metrics, analyzerState, lastErrorRef, setMetrics, setState, setWaveform, setError });
    });
    return () => {
      void analyzer.stop();
      analyzerRef.current = null;
    };
  }, [analyzerRef, lastErrorRef, setMetrics, setState, setWaveform, setError]);
}

function handleAnalyzerUpdate(context: AnalyzerUpdateContext): void {
  const { analyzer, metrics, analyzerState, lastErrorRef, setMetrics, setState, setWaveform, setError } = context;
  setMetrics(metrics);
  setState(analyzerState);
  setWaveform(analyzer.getWaveform());
  const failure = analyzer.getLastError();
  if (failure && failure !== lastErrorRef.current) {
    lastErrorRef.current = failure;
    setError(failure);
  }
}

function useErrorAlerts(error: Error | null): void {
  useEffect(() => {
    if (!error) {
      return;
    }
    Alert.alert('PPG Error', error.message);
  }, [error]);
}

function useSampleHandler(analyzerRef: React.MutableRefObject<PPGAnalyzer | null>) {
  return useCallback((sample: PPGSample) => {
    analyzerRef.current?.addSample(sample);
  }, [analyzerRef]);
}

function useStartHandler(
  analyzerRef: React.MutableRefObject<PPGAnalyzer | null>,
  setError: React.Dispatch<React.SetStateAction<Error | null>>,
) {
  return useCallback(async () => {
    try {
      await analyzerRef.current?.start();
    } catch (error) {
      setError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [analyzerRef, setError]);
}

function useStopHandler(
  analyzerRef: React.MutableRefObject<PPGAnalyzer | null>,
  setError: React.Dispatch<React.SetStateAction<Error | null>>,
) {
  return useCallback(async () => {
    try {
      await analyzerRef.current?.stop();
    } catch (error) {
      setError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [analyzerRef, setError]);
}

function IdlePlaceholder(): JSX.Element {
  return (
    <View style={styles.idle}>
      <Text style={styles.idleText}>Tap start to begin measurement</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  cameraArea: { flex: 1 },
  idle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  idleText: { color: '#666', fontSize: 16 },
});
