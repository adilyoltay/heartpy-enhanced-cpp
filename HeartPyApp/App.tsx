import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  unstable_batchedUpdates,
} from 'react-native';
import {PPGCamera} from './src/components/PPGCamera';
import {PPGDisplay} from './src/components/PPGDisplay';
import {PPGParameterControls} from './src/components/PPGParameterControls';
import {
  PPGAnalyzer,
  DEFAULT_ANALYZER_OPTIONS,
  type AnalyzerTuningOptions,
} from './src/core/PPGAnalyzer';
import {PPG_CONFIG} from './src/core/PPGConfig';
import {useMasterTimer, usePPGReducer} from './src/core/state/ppgStore';
import type {
  PPGSample,
  PPGState as PPGLifecycleState,
  PPGAnalysisFrame,
} from './src/types/PPGTypes';

function useAnalyzer() {
  const analyzerRef = useRef<PPGAnalyzer | null>(null);
  const [ppgState, dispatch] = usePPGReducer();
  const [options, setOptions] = useState<AnalyzerTuningOptions>({
    ...DEFAULT_ANALYZER_OPTIONS,
  });
  const masterIntervalMs = Math.min(
    Math.max(PPG_CONFIG.uiUpdateIntervalMs ?? 50, 16),
    50,
  );
  const {
    addTask,
    removeTask,
    stats: masterStats,
  } = useMasterTimer(masterIntervalMs);
  const tasksRegisteredRef = useRef(false);
  const ppgStateRef = useRef(ppgState);
  const lastPollAtRef = useRef<number>(0);
  const schedulerStatsRef = useRef({ticks: 0, skipped: 0});
  const lastDropLogRef = useRef(0);

  useEffect(() => {
    ppgStateRef.current = ppgState;
  }, [ppgState]);

  const teardownSchedulerTasks = useCallback(() => {
    removeTask('ppg.poll');
    removeTask('ppg.telemetry');
    removeTask('ppg.watchdog');
    tasksRegisteredRef.current = false;
  }, [removeTask]);

  const decimateWaveform = useCallback(
    (waveform: ReadonlyArray<{value: number; timestamp: number}>) => {
      const limit = PPG_CONFIG.waveformTailSamples ?? 200;
      if (waveform.length <= limit) {
        return waveform;
      }
      const stride = Math.ceil(waveform.length / limit);
      const decimated: Array<{value: number; timestamp: number}> = [];
      for (let i = 0; i < waveform.length; i += stride) {
        decimated.push(waveform[i]);
      }
      return decimated;
    },
    [],
  );

  const handleFrame = useCallback(
    (frame: PPGAnalysisFrame) => {
      const payloadWaveform = decimateWaveform(frame.waveform);
      unstable_batchedUpdates(() => {
        dispatch({type: 'SET_METRICS', payload: frame.metrics});
        dispatch({type: 'APPEND_WAVEFORM', payload: payloadWaveform});
      });
    },
    [decimateWaveform, dispatch],
  );

  const registerSchedulerTasks = useCallback(() => {
    const analyzer = analyzerRef.current;
    if (!analyzer) {
      return;
    }

    const pollTask = {
      id: 'ppg.poll',
      intervalMs: masterIntervalMs,
      description: 'PPG analyzer polling',
      run: async () => {
        const summary = await analyzer.processTick();
        if (summary.droppedSamples && summary.droppedSamples > 0) {
          const now = Date.now();
          if (
            now - lastDropLogRef.current > 1_000 &&
            PPG_CONFIG.debug.enabled
          ) {
            lastDropLogRef.current = now;
            console.warn('[App] Back-pressure dropping samples', {
              dropped: summary.droppedSamples,
              pendingSamples: summary.pendingSamples,
            });
          }
        }

        if (summary.polled) {
          lastPollAtRef.current = Date.now();
        }

        unstable_batchedUpdates(() => {
          dispatch({
            type: 'TICK_DEBUG',
            payload: {
              schedulerTicks: 1,
              polls: summary.polled ? 1 : 0,
              framesEmitted: summary.emittedFrame ? 1 : 0,
            },
          });
        });
      },
    } as const;

    const telemetryTask = {
      id: 'ppg.telemetry',
      intervalMs: 10_000,
      description: 'PPG telemetry flush',
      run: () => {
        const {ticks, skipped} = masterStats;
        const deltaSkipped = skipped - schedulerStatsRef.current.skipped;
        schedulerStatsRef.current = {ticks, skipped};
        const payload: Record<string, number> = {lastFlushTs: Date.now()};
        if (deltaSkipped > 0) {
          payload.schedulerSkips = deltaSkipped;
        }
        if (PPG_CONFIG.debug.enableSchedulerLogging) {
          console.log('[App] Scheduler telemetry snapshot', {
            ticks,
            skipped,
            deltaSkipped,
          });
        }
        unstable_batchedUpdates(() => {
          dispatch({type: 'TICK_DEBUG', payload});
        });
      },
    } as const;

    const watchdogTask = {
      id: 'ppg.watchdog',
      intervalMs: 1_000,
      description: 'PPG watchdog',
      run: () => {
        const now = Date.now();
        const lifecycle = ppgStateRef.current.lifecycle;
        if (lifecycle !== 'running') {
          return;
        }
        const lastPollDelta = now - lastPollAtRef.current;
        if (lastPollDelta > 3_000) {
          if (PPG_CONFIG.debug.enabled) {
            console.warn('[App] Watchdog: analyzer poll stalled', {
              lastPollDelta,
            });
          }
          unstable_batchedUpdates(() => {
            dispatch({type: 'SET_ERROR', payload: 'poll-timeout'});
          });
        } else if (ppgStateRef.current.lastError === 'poll-timeout') {
          unstable_batchedUpdates(() => {
            dispatch({type: 'SET_ERROR', payload: null});
          });
        }
      },
    } as const;

    removeTask(pollTask.id);
    removeTask(telemetryTask.id);
    removeTask(watchdogTask.id);

    addTask(pollTask);
    addTask(telemetryTask);
    addTask(watchdogTask);

    tasksRegisteredRef.current = true;
  }, [addTask, removeTask, dispatch, masterIntervalMs, masterStats]);

  const handleStateChange = useCallback(
    (nextState: PPGLifecycleState) => {
      if (PPG_CONFIG.debug.enabled) {
        console.log('[App] Analyzer state changed', {nextState});
      }

      unstable_batchedUpdates(() => {
        dispatch({type: 'SET_LIFECYCLE', payload: nextState});
        dispatch({type: 'SET_ACTIVE', payload: nextState !== 'idle'});
        dispatch({type: 'SET_ANALYZING', payload: nextState === 'running'});
        if (nextState === 'idle') {
          dispatch({type: 'RESET_WAVEFORM'});
        }
      });

      if (nextState === 'running') {
        registerSchedulerTasks();
      }
      if (nextState === 'idle') {
        teardownSchedulerTasks();
      }
    },
    [dispatch, registerSchedulerTasks, teardownSchedulerTasks],
  );

  useEffect(() => {
    console.log('[App] Initializing analyzer');
    analyzerRef.current = new PPGAnalyzer({
      onStateChange: handleStateChange,
      onFrame: handleFrame,
      onHeartRateUpdate: update => {
        if (PPG_CONFIG.debug.enabled) {
          console.log('[App] Heart rate update', update);
        }
      },
    });
    return () => {
      console.log('[App] Cleaning up analyzer');
      teardownSchedulerTasks();
      analyzerRef.current?.stop().catch(console.warn);
      analyzerRef.current = null;
    };
  }, [handleFrame, handleStateChange, teardownSchedulerTasks]);

  const start = useCallback(async () => {
    console.log(
      '[App] Start button pressed, current state:',
      ppgStateRef.current.lifecycle,
    );
    if (tasksRegisteredRef.current) {
      teardownSchedulerTasks();
    }
    try {
      await analyzerRef.current?.start();
      console.log('[App] Start completed successfully');
    } catch (error) {
      console.error('[App] Start failed:', error);
      unstable_batchedUpdates(() => {
        dispatch({type: 'SET_ERROR', payload: 'start-failed'});
        dispatch({type: 'SET_ACTIVE', payload: false});
      });
    }
  }, [dispatch, teardownSchedulerTasks]);

  const stop = useCallback(async () => {
    console.log(
      '[App] Stop requested, current state:',
      ppgStateRef.current.lifecycle,
    );
    teardownSchedulerTasks();
    await analyzerRef.current?.stop();
    console.log('[App] Stop completed');
  }, [teardownSchedulerTasks]);

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
        state: ppgStateRef.current.lifecycle,
      });
    }

    try {
      await analyzerRef.current?.addSample(sample);
    } catch (error) {
      console.warn('[App] Sample processing failed:', error);
    }
  }, []);

  const updateSampleRate = useCallback((fps: number) => {
    analyzerRef.current?.updateSampleRate(fps);
  }, []);

  const updateOptions = useCallback(
    async (partial: Partial<AnalyzerTuningOptions>) => {
      const entries = Object.entries(partial).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length === 0) {
        return;
      }

      const sanitized = Object.fromEntries(
        entries,
      ) as Partial<AnalyzerTuningOptions>;

      setOptions(prev => ({
        ...prev,
        ...sanitized,
      }));

      try {
        await analyzerRef.current?.configure(sanitized);
      } catch (error) {
        console.error('[App] Failed to apply analyzer options', error);
      }
    },
    [],
  );

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

  const analysisData = useMemo<PPGAnalysisFrame>(
    () => ({
      metrics: ppgState.metrics,
      waveform: ppgState.waveform,
    }),
    [ppgState.metrics, ppgState.waveform],
  );

  return {
    analysisData,
    state: ppgState.lifecycle,
    start,
    stop,
    addSample,
    updateSampleRate,
    options,
    updateOptions,
    resetOptions,
    snrMetrics,
  };
}

function App(): React.JSX.Element {
  const {
    analysisData,
    state,
    start,
    stop,
    addSample,
    updateSampleRate,
    options,
    updateOptions,
    resetOptions,
    snrMetrics,
  } = useAnalyzer();

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
