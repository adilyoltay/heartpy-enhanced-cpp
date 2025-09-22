import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import Sound from 'react-native-sound';
import {PPG_CONFIG} from '../core/PPGConfig';
import type {PPGAnalysisFrame, PPGState} from '../types/PPGTypes';
import SkiaWaveform from './SkiaWaveform';

const HEARTBEAT_SOUND = require('../../assets/sounds/heartbeat.wav');

// Bu component artık doğrudan C++'tan gelen senkronize edilmiş
// dalga formu snapshot'ını render eder.
type Props = {
  data: PPGAnalysisFrame; // Gelen veri artık tam bir analiz çerçevesi
  state: PPGState;
  onStart: () => void;
  onStop: () => void;
  snrMetrics?: {
    nativeSnrCount: number;
    fallbackSnrCount: number;
    invalidSnrCount: number;
    snrHistory: number[];
    snrThresholdCrossings: {
      poor: number;
      ui: number;
      haptic: number;
      reliable: number;
    };
  }; // SNR debug metrics (optional)
};

const MAX_WAVEFORM_POINTS = 240;

const MetricCard = React.memo(
  ({label, value}: {label: string; value: string}) => (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  ),
  (prev, next) => prev.label === next.label && prev.value === next.value,
);

const PPGDisplayComponent = ({
  data,
  state,
  onStart,
  onStop,
  snrMetrics,
}: Props): JSX.Element => {
  const {metrics, waveform} = data;

  const renderStatsRef = useRef({
    count: 0,
    lastLoggedCount: 0,
    lastLogTs: Date.now(),
  });
  renderStatsRef.current.count += 1;

  useEffect(() => {
    if (!PPG_CONFIG.debug.enabled) {
      return;
    }
    const now = Date.now();
    const elapsed = now - renderStatsRef.current.lastLogTs;
    if (elapsed >= 1_000) {
      const rendersSince =
        renderStatsRef.current.count - renderStatsRef.current.lastLoggedCount;
      console.log('[PPGDisplay] Render cadence', {
        rendersSince,
        elapsedMs: elapsed,
      });
      renderStatsRef.current.lastLoggedCount = renderStatsRef.current.count;
      renderStatsRef.current.lastLogTs = now;
    }
  });

  // --- GÜNCEL HAPTIC MANTIĞI ---
  const lastHapticPeakTsRef = useRef<number>(0);
  const lastHapticTimeRef = useRef<number>(0);
  const heartSoundRef = useRef<Sound | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);

  useEffect(() => {
    if (!PPG_CONFIG.debug.enabled) {
      return;
    }
    console.log('[PPGDisplay] Audio loaded state', {audioLoaded});
  }, [audioLoaded]);

  // Heartbeat sound'u yükle
  useEffect(() => {
    const sound = new Sound(HEARTBEAT_SOUND, undefined, error => {
      if (error) {
        console.warn('[PPGDisplay] Heartbeat sound yüklenemedi', error);
        setAudioLoaded(false);
      } else {
        console.log('[PPGDisplay] Heartbeat sound başarıyla yüklendi', {
          soundPath: HEARTBEAT_SOUND,
        });
        setAudioLoaded(true);
      }
    });
    heartSoundRef.current = sound;

    return () => {
      heartSoundRef.current?.release();
      heartSoundRef.current = null;
      setAudioLoaded(false);
    };
  }, []);

  useEffect(() => {
    if (
      state !== 'running' ||
      !metrics?.peakTimestamps ||
      metrics.peakTimestamps.length === 0
    ) {
      return;
    }

    const pollId = metrics?.pollId ?? null;
    const pollTimestamp = metrics?.pollTimestamp ?? null;
    const verboseLogging = PPG_CONFIG.debug.enableDetailedSnrLogging === true;
    const snrDebug = (metrics?.snrDebug ?? {}) as {
      originalSnrDb?: number | null;
      sanitizedSnrDb?: number;
      isFallbackUsed?: boolean;
      fallbackRatioPct?: number;
      fallbackReason?: string;
      f0Hz?: number | null;
      hardFallbackActive?: boolean;
      warmupActive?: boolean;
      sampleCount?: number | null;
    };
    const sanitizedSnrDb =
      typeof snrDebug?.sanitizedSnrDb === 'number'
        ? snrDebug.sanitizedSnrDb
        : (metrics.snrDb ?? -10);
    const originalSnrDb =
      typeof snrDebug?.originalSnrDb === 'number'
        ? snrDebug.originalSnrDb
        : null;
    const snrFallbackUsed = !!snrDebug?.isFallbackUsed;

    const resolvedSignalQuality = (metrics?.signalQuality ??
      metrics?.quality?.signalQuality ??
      'unknown') as string;
    const confidenceOk =
      (metrics.confidence ?? 0) >= PPG_CONFIG.hapticMinConfidence;
    const snrOk = sanitizedSnrDb > PPG_CONFIG.snrDbThresholdHaptic;
    const qualityOk = resolvedSignalQuality === 'good';
    const isReliableForHaptic = confidenceOk && snrOk && qualityOk;

    if (!isReliableForHaptic) {
      if (PPG_CONFIG.debug.enabled && verboseLogging) {
        const latestPeakTs = Math.max(...metrics.peakTimestamps);
        const now = Date.now();
        console.log('[PPGDisplay] Haptic guard failed', {
          pollId,
          pollTimestamp,
          state,
          confidence: metrics.confidence,
          snrDb: sanitizedSnrDb,
          originalSnrDb,
          snrFallbackUsed,
          signalQuality: resolvedSignalQuality,
          snrFallbackRatioPct: snrDebug.fallbackRatioPct,
          snrFallbackReason: snrDebug.fallbackReason,
          f0Hz: snrDebug.f0Hz,
          hardFallbackActive: snrDebug.hardFallbackActive,
          warmupActive: snrDebug.warmupActive,
          snrSampleCount: snrDebug.sampleCount,
          thresholds: {
            minConfidence: PPG_CONFIG.hapticMinConfidence,
            snrThreshold: PPG_CONFIG.snrDbThresholdHaptic,
          },
          flags: {
            confidenceOk,
            snrOk,
            qualityOk,
          },
          latestPeakTs,
          now,
          deltaMs: now - latestPeakTs,
        });
      }
      if (PPG_CONFIG.debug.enabled && !verboseLogging) {
        console.log('[PPGDisplay] Haptic guard skipped', {
          pollId,
          confidence: metrics.confidence,
          snrDb: sanitizedSnrDb,
          signalQuality: resolvedSignalQuality,
        });
      }
      return;
    }

    const now = Date.now();
    const MIN_INTERVAL_MS = PPG_CONFIG.hapticDebounceMs; // Config'den al

    const latestPeakTs = Math.max(...metrics.peakTimestamps);
    const peakDeltaMs = now - latestPeakTs;
    const timeSinceLastTrigger = now - lastHapticTimeRef.current;
    const isNewPeak = latestPeakTs > lastHapticPeakTsRef.current;
    const passesDebounce = timeSinceLastTrigger > MIN_INTERVAL_MS;
    const pollToTriggerMs = pollTimestamp ? now - pollTimestamp : null;

    if (PPG_CONFIG.debug.enabled && verboseLogging) {
      console.log('[PPGDisplay] Haptic timing eval', {
        pollId,
        latestPeakTs,
        lastTriggeredPeak: lastHapticPeakTsRef.current,
        isNewPeak,
        timeSinceLastTrigger,
        debounceMs: MIN_INTERVAL_MS,
        peakDeltaMs,
        passesDebounce,
        deviceNow: now,
        pollTimestamp,
        pollToTriggerMs,
      });
    }

    if (!isNewPeak) {
      if (PPG_CONFIG.debug.enabled && verboseLogging) {
        console.log('[PPGDisplay] Haptic skipped (stale peak)', {
          pollId,
          latestPeakTs,
          lastTriggeredPeak: lastHapticPeakTsRef.current,
        });
      }
      return;
    }

    if (!passesDebounce) {
      if (PPG_CONFIG.debug.enabled && verboseLogging) {
        console.log('[PPGDisplay] Haptic skipped (debounce active)', {
          pollId,
          timeSinceLastTrigger,
          debounceMs: MIN_INTERVAL_MS,
          latestPeakTs,
        });
      }
      return;
    }

    console.log(
      '[PPGDisplay] HAPTIC TRIGGERED for peak timestamp:',
      latestPeakTs,
      {
        pollId,
        pollTimestamp,
        pollToTriggerMs,
        confidence: metrics.confidence,
        snrDb: sanitizedSnrDb,
        originalSnrDb,
        snrFallbackUsed,
        snrFallbackRatioPct: snrDebug.fallbackRatioPct,
        snrFallbackReason: snrDebug.fallbackReason,
        f0Hz: snrDebug.f0Hz,
        hardFallbackActive: snrDebug.hardFallbackActive,
        warmupActive: snrDebug.warmupActive,
        snrSampleCount: snrDebug.sampleCount,
        signalQuality: resolvedSignalQuality,
        timeSinceLast: timeSinceLastTrigger,
        debounceMs: MIN_INTERVAL_MS,
        peakDeltaMs,
        deviceNow: now,
      },
    );

    // Haptic feedback
    console.log('[PPGDisplay] ReactNativeHapticFeedback.trigger', {
      intensity: PPG_CONFIG.hapticIntensity,
      pollId,
    });
    ReactNativeHapticFeedback.trigger(PPG_CONFIG.hapticIntensity, {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: true,
    });

    // Heartbeat sound çal
    const heartSound = heartSoundRef.current;
    if (heartSound && heartSound.isLoaded()) {
      console.log('[PPGDisplay] Heartbeat sound playback attempt', {
        audioLoaded,
        duration: heartSound.getDuration ? heartSound.getDuration() : undefined,
      });
      heartSound.stop(() => {
        heartSound.play(success => {
          if (success) {
            console.log('[PPGDisplay] Heartbeat sound çalındı');
          } else {
            console.warn('[PPGDisplay] Heartbeat sound çalınamadı');
          }
        });
      });
    } else {
      console.warn('[PPGDisplay] Heartbeat sound ready değil', {
        hasSoundInstance: !!heartSound,
        isLoaded: heartSound ? heartSound.isLoaded() : false,
        audioLoadedState: audioLoaded,
      });
    }

    lastHapticPeakTsRef.current = latestPeakTs;
    lastHapticTimeRef.current = now;
  }, [metrics, state]);

  // --- GÜNCEL ve BASİTLEŞTİRİLMİŞ MARKER MANTIĞI ---
  const peakTimestampSet = useMemo(() => {
    // Gelen metriklerdeki tepe noktası zaman damgalarını bir Set'e koy
    return new Set(metrics?.peakTimestamps || []);
  }, [metrics]);

  const displayWaveform = useMemo(() => {
    if (!waveform || waveform.length <= MAX_WAVEFORM_POINTS) {
      return waveform;
    }
    const stride = Math.ceil(waveform.length / MAX_WAVEFORM_POINTS);
    const sampled: typeof waveform = [] as typeof waveform;
    for (let i = 0; i < waveform.length; i += stride) {
      sampled.push(waveform[i]);
      if (sampled.length >= MAX_WAVEFORM_POINTS) {
        break;
      }
    }
    return sampled;
  }, [waveform]);

  const waveformPoints = displayWaveform ?? [];

  useEffect(() => {
    if (PPG_CONFIG.debug.enableSchedulerLogging) {
      console.log('[PPGDisplay] Waveform sample count', {
        points: waveformPoints.length,
      });
    }
  }, [waveformPoints.length]);

  const metricsViewModel = useMemo(() => {
    const bpm = metrics?.bpm;
    const snr = metrics?.snrDb ?? metrics?.quality?.snrDb;
    const confidence = metrics?.confidence ?? metrics?.quality?.confidence;
    return {
      bpm: bpm != null ? bpm.toFixed(1) : '--',
      snr: snr != null ? snr.toFixed(2) : '--',
      confidence: confidence != null ? confidence.toFixed(2) : '--',
    };
  }, [
    metrics?.bpm,
    metrics?.confidence,
    metrics?.quality?.confidence,
    metrics?.quality?.snrDb,
    metrics?.snrDb,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.metricsRow}>
        <MetricCard label="BPM" value={metricsViewModel.bpm} />
        <MetricCard label="SNR (dB)" value={metricsViewModel.snr} />
        <MetricCard label="Confidence" value={metricsViewModel.confidence} />
      </View>

      {/* SNR Debug Metrics (only in debug mode) */}
      {__DEV__ && snrMetrics && (
        <View style={styles.debugMetricsContainer}>
          <Text style={styles.debugTitle}>SNR Debug Metrics</Text>
          <View style={styles.debugMetricsRow}>
            <MetricCard
              label="Native"
              value={snrMetrics.nativeSnrCount.toString()}
            />
            <MetricCard
              label="Fallback"
              value={`${snrMetrics.fallbackSnrCount} (${snrMetrics.nativeSnrCount > 0 ? ((snrMetrics.fallbackSnrCount / (snrMetrics.nativeSnrCount + snrMetrics.fallbackSnrCount)) * 100).toFixed(1) : 0}%)`}
            />
            <MetricCard
              label="Invalid"
              value={snrMetrics.invalidSnrCount.toString()}
            />
          </View>
          <View style={styles.thresholdMetricsRow}>
            <Text style={styles.thresholdText}>
              Thresholds: Poor({snrMetrics.snrThresholdCrossings.poor}) | UI(
              {snrMetrics.snrThresholdCrossings.ui}) | Haptic(
              {snrMetrics.snrThresholdCrossings.haptic}) | Reliable(
              {snrMetrics.snrThresholdCrossings.reliable})
            </Text>
          </View>
        </View>
      )}

      <View style={styles.waveform}>
        <SkiaWaveform points={waveformPoints} peaks={peakTimestampSet} />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          onPress={onStart}
          disabled={state !== 'idle'}
          style={[
            styles.button,
            styles.startButton,
            state !== 'idle' && styles.buttonDisabled,
          ]}>
          <Text style={styles.buttonText}>Başlat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onStop}
          disabled={state === 'idle'}
          style={[
            styles.button,
            styles.stopButton,
            state === 'idle' && styles.buttonDisabled,
          ]}>
          <Text style={styles.buttonText}>Durdur</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const PPGDisplay = React.memo(PPGDisplayComponent);

const styles = StyleSheet.create({
  container: {gap: 16, flex: 1, justifyContent: 'center'},
  metricsRow: {flexDirection: 'row', justifyContent: 'space-around'},
  metricBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#111',
    alignItems: 'center',
    minWidth: 80,
  },
  metricLabel: {color: '#ccc', fontSize: 12, marginBottom: 4},
  metricValue: {color: '#fff', fontSize: 28, fontWeight: '600'},
  waveform: {
    height: 120,
    borderRadius: 12,
    backgroundColor: '#1d1d1d',
    overflow: 'hidden',
  },
  controls: {flexDirection: 'row', gap: 12},
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  startButton: {backgroundColor: '#4caf50'},
  stopButton: {backgroundColor: '#f44336'},
  buttonDisabled: {opacity: 0.4},
  debugMetricsContainer: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    marginTop: 8,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  debugMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 4,
  },
  thresholdMetricsRow: {
    marginTop: 4,
  },
  thresholdText: {
    color: '#888',
    fontSize: 10,
    textAlign: 'center',
    flexWrap: 'wrap',
  },
});
