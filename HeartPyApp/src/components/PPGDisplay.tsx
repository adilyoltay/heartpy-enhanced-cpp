import React, {useEffect, useMemo, useRef} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {PPG_CONFIG} from '../core/PPGConfig';
import type {PPGAnalysisFrame, PPGState} from '../types/PPGTypes';

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

export function PPGDisplay({data, state, onStart, onStop, snrMetrics}: Props): JSX.Element {
  const {metrics, waveform} = data;
  const bpmDisplay = metrics?.bpm ? metrics.bpm.toFixed(1) : '--';

  // --- GÜNCEL HAPTIC MANTIĞI ---
  const lastHapticPeakTsRef = useRef<number>(0);
  const lastHapticTimeRef = useRef<number>(0);

  useEffect(() => {
    if (
      state !== 'running' ||
      !metrics?.peakTimestamps ||
      metrics.peakTimestamps.length === 0
    ) {
      return;
    }

    const isReliableForHaptic =
      (metrics.confidence ?? 0) >= 0.5 && (metrics.snrDb ?? -10) > PPG_CONFIG.snrDbThresholdHaptic;
    if (!isReliableForHaptic) return;

    const now = Date.now();
    const MIN_INTERVAL_MS = 300; // Debounce

    const latestPeakTs = Math.max(...metrics.peakTimestamps);

    if (
      latestPeakTs > lastHapticPeakTsRef.current &&
      now - lastHapticTimeRef.current > MIN_INTERVAL_MS
    ) {
      ReactNativeHapticFeedback.trigger('impactLight');
      lastHapticPeakTsRef.current = latestPeakTs;
      lastHapticTimeRef.current = now;
    }
  }, [metrics, state]);

  // --- GÜNCEL ve BASİTLEŞTİRİLMİŞ MARKER MANTIĞI ---
  const peakTimestampSet = useMemo(() => {
    // Gelen metriklerdeki tepe noktası zaman damgalarını bir Set'e koy
    return new Set(metrics?.peakTimestamps || []);
  }, [metrics]);

  // Dalga formu verisindeki min/max değerlerini hesapla
  const values = waveform.map(i => i.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const span = max - min || 1;

  return (
    <View style={styles.container}>
        <View style={styles.metricsRow}>
          <Metric label="BPM" value={bpmDisplay} />
          <Metric
            label="SNR (dB)"
            value={metrics?.snrDb?.toFixed(2) ?? '--'}
          />
          <Metric
            label="Confidence"
            value={metrics?.confidence?.toFixed(2) ?? '--'}
          />
        </View>

        {/* SNR Debug Metrics (only in debug mode) */}
        {__DEV__ && snrMetrics && (
          <View style={styles.debugMetricsContainer}>
            <Text style={styles.debugTitle}>SNR Debug Metrics</Text>
            <View style={styles.debugMetricsRow}>
              <Metric
                label="Native"
                value={snrMetrics.nativeSnrCount.toString()}
              />
              <Metric
                label="Fallback"
                value={`${snrMetrics.fallbackSnrCount} (${snrMetrics.nativeSnrCount > 0 ? ((snrMetrics.fallbackSnrCount / (snrMetrics.nativeSnrCount + snrMetrics.fallbackSnrCount)) * 100).toFixed(1) : 0}%)`}
              />
              <Metric
                label="Invalid"
                value={snrMetrics.invalidSnrCount.toString()}
              />
            </View>
            <View style={styles.thresholdMetricsRow}>
              <Text style={styles.thresholdText}>
                Thresholds: Poor({snrMetrics.snrThresholdCrossings.poor}) |
                UI({snrMetrics.snrThresholdCrossings.ui}) |
                Haptic({snrMetrics.snrThresholdCrossings.haptic}) |
                Reliable({snrMetrics.snrThresholdCrossings.reliable})
              </Text>
            </View>
          </View>
        )}

      <View style={styles.waveform}>
        {/*
          Doğrudan C++'tan gelen senkronize dalga formunu render et.
          Artık .slice() işlemine gerek yok.
        */}
        {waveform.map((item, index) => {
          // Bu bar'ın zaman damgası, tepe noktası set'inde var mı?
          const isPickPoint = peakTimestampSet.has(item.timestamp);
          const height = ((item.value - min) / span) * 100 + 2;

          return (
            <View
              key={index} // index burada key olarak güvenli çünkü dizi her render'da yeniden yaratılıyor
              style={[
                styles.waveformBar,
                {height},
                isPickPoint && styles.waveformBarPick,
              ]}
            />
          );
        })}
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
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

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
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 4,
      overflow: 'hidden',
    },
    waveformBar: {flex: 1, backgroundColor: '#39d353', borderRadius: 2, marginHorizontal: 1},
    waveformBarPick: {backgroundColor: '#F44336'},
    controls: {flexDirection: 'row', gap: 12},
    button: {flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
    buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
    startButton: {backgroundColor: '#4caf50'},
    stopButton: {backgroundColor: '#f44336'},
    buttonDisabled: {opacity: 0.4},
    // Debug styles
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
