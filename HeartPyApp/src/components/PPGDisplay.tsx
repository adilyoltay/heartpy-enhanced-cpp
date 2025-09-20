import React, {useEffect, useMemo, useRef} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import type {PPGMetrics, PPGState} from '../types/PPGTypes';
import {PPG_CONFIG} from '../core/PPGConfig';

type Props = {
  metrics: PPGMetrics | null;
  waveform: readonly number[];
  state: PPGState;
  onStart: () => void;
  onStop: () => void;
};

export function PPGDisplay({
  metrics,
  waveform,
  state,
  onStart,
  onStop,
}: Props): JSX.Element {
  const totalBeats = metrics?.quality.totalBeats ?? 0;
  const snrDb = metrics?.snrDb ?? -10;
  const reliability = metrics?.confidence ?? 0;
  const goodQuality = metrics?.quality.goodQuality ?? false;

  // FIXED: More robust reliability check - use multiple factors
  const isReliable = goodQuality &&
                    reliability >= PPG_CONFIG.reliabilityThreshold &&
                    snrDb >= PPG_CONFIG.snrDbThresholdUI;

  const isWarmingUp = metrics && !isReliable && totalBeats < 4;
  
  const bpmDisplay = isReliable && metrics ? metrics.bpm.toFixed(1) : '--';
  const reliabilityPct = metrics ? (reliability * 100).toFixed(0) : '--';
  const snr = metrics ? snrDb.toFixed(1) : '--';
  const quality = metrics ? metrics.quality.signalQuality : 'unknown';
  
  // Signal Quality Color Helpers
  const getConfidenceColor = (confidence?: number | null): string => {
    if (confidence == null || Number.isNaN(confidence)) return '#666';
    if (confidence >= 0.7) return '#4CAF50'; // Green - Excellent
    if (confidence >= 0.5) return '#FF9800'; // Orange - Good
    if (confidence >= 0.3) return '#FF5722'; // Red-Orange - Fair
    return '#F44336'; // Red - Poor
  };
  
  const getSNRColor = (snrDb?: number | null): string => {
    if (snrDb == null || !Number.isFinite(snrDb)) return '#666';
    if (snrDb >= 15) return '#4CAF50'; // Green - Excellent
    if (snrDb >= 10) return '#8BC34A'; // Light Green - Good
    if (snrDb >= 5) return '#FF9800'; // Orange - Fair
    return '#F44336'; // Red - Poor
  };
  
  const getQualityColor = (quality: string): string => {
    switch (quality.toLowerCase()) {
      case 'excellent': return '#4CAF50';
      case 'good': return '#8BC34A';
      case 'fair': return '#FF9800';
      case 'poor': return '#F44336';
      default: return '#666';
    }
  };
  
  // Pick detection and haptic feedback
  const lastBpmRef = useRef<number | null>(null);
  const lastPickTimeRef = useRef<number>(0);
  const lastTotalBeatsRef = useRef<number>(0);
  
  useEffect(() => {
    // P0 FIX: Decouple haptic trigger from peak filtering - use totalBeats count instead
    if (!metrics || state !== 'running') return;

    const currentBpm = metrics.bpm;
    const currentTime = Date.now();
    const totalBeats = metrics.quality?.totalBeats || 0;

    if (isReliable && currentBpm > 0 && snrDb > PPG_CONFIG.snrDbThresholdUI) {
      const expectedInterval = 60000 / currentBpm; // ms between beats
      const timeSinceLast = currentTime - lastPickTimeRef.current;
      
      // P0 FIX: Simple time-based debounce (300ms minimum) instead of complex BPM rate limiting
      const minInterval = 300; // ms
      const beatDetected = totalBeats > lastTotalBeatsRef.current;
      const firstReliable = lastBpmRef.current === null;
      
      if ((beatDetected && timeSinceLast > minInterval) || firstReliable) {
        // P0 FIX: Strengthen haptic feedback for better perception
        ReactNativeHapticFeedback.trigger('impactMedium', {
          enableVibrateFallback: true,
          ignoreAndroidSystemSettings: true, // FIXED: Allow stronger Android vibration
        });
        lastPickTimeRef.current = currentTime;
        console.log('💓 Heart beat detected - BPM:', currentBpm.toFixed(1), 'SNR:', snrDb.toFixed(1), 'TotalBeats:', totalBeats, 'Haptic triggered');
      }

      lastBpmRef.current = currentBpm;
      lastTotalBeatsRef.current = totalBeats;
    } else if (!isReliable && lastBpmRef.current !== null) {
      // Reset tracking when unreliable to avoid false triggers
      lastBpmRef.current = null;
      lastTotalBeatsRef.current = 0;
      console.log('💓 Haptic disabled - BPM unreliable (reliability:', reliability.toFixed(2), 'SNR:', snrDb.toFixed(1), ')');
    }
  }, [metrics, state, isReliable, snrDb, reliability]);
  
  // Use HeartPy peakList directly (no duplication)
  const pickPoints = metrics?.peakList || [];

  return (
    <View style={styles.container}>
      {/* Poor Signal Alert */}
      {state === 'running' && metrics && !isReliable && (
        <View style={styles.poorSignalAlert}>
          <Text style={styles.poorSignalText}>
            ⚠️ Sinyal kalitesi düşük! Parmak pozisyonunu kontrol edin.
          </Text>
        </View>
      )}
      
      {/* Status Message */}
      {state === 'running' && !isReliable && (
        <View style={styles.statusMessage}>
          <Text style={styles.statusText}>
            {isWarmingUp
              ? `HeartPy hazırlanıyor... (${metrics?.quality.totalBeats || 0}/4 beat)`
              : metrics && metrics.quality.totalBeats < 4 
              ? `Ölçüm hazırlanıyor... (${metrics.quality.totalBeats}/4 kalp atışı)`
              : metrics && !metrics.quality.goodQuality
              ? `Kalite kontrolü başarısız...`
              : metrics && snrDb <= PPG_CONFIG.snrDbThresholdUI
              ? `SNR çok düşük... (${snrDb.toFixed(1)} dB)`
              : reliability < PPG_CONFIG.reliabilityThreshold
              ? `Güven skoru düşük... (${reliabilityPct}%)`
              : 'Ölçüm hazırlanıyor...'
            }
          </Text>
        </View>
      )}
      
      <View style={styles.metricsRow}>
        <Metric label="BPM" value={bpmDisplay} suffix="" />
        <Metric label="Güven" value={reliabilityPct} suffix="%" color={getConfidenceColor(reliability)} />
        <Metric label="SNR" value={snr} suffix="dB" color={getSNRColor(snrDb)} />
        <Metric label="Kalite" value={quality.toUpperCase()} suffix="" color={getQualityColor(quality)} />
      </View>

      <View style={styles.waveform}>
        {waveform.length === 0 ? (
          <Text style={styles.waveformEmpty}>Örnek bekleniyor…</Text>
        ) : (() => {
          // OPTIMIZATION: Precompute min/max to avoid O(n²) in map
          const waveformSlice = waveform.slice(-PPG_CONFIG.waveformTailSamples);
          const min = Math.min(...waveformSlice);
          const max = Math.max(...waveformSlice);
          const span = max - min || 1;
          
                 return waveformSlice.map((value, index) => {
                   const height = ((value - min) / span) * 80 + 4;
                   
                   // Check if this index corresponds to a HeartPy peak (now in relative coordinates)
                   const isPickPoint = pickPoints.includes(index);
                   
                   return (
                     <View 
                       key={index} 
                       style={[
                         styles.waveformBar, 
                         {height},
                         isPickPoint && styles.waveformBarPick
                       ]} 
                     />
                   );
                 });
        })()}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.button,
            styles.startButton,
            state !== 'idle' && styles.buttonDisabled,
          ]}
          onPress={onStart}
          disabled={state !== 'idle'}>
          <Text style={styles.buttonText}>Başlat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            styles.stopButton,
            state === 'idle' && styles.buttonDisabled,
          ]}
          onPress={onStop}
          disabled={state === 'idle'}>
          <Text style={styles.buttonText}>Durdur</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.stateLabel}>Durum: {state}</Text>
    </View>
  );
}

function Metric({
  label,
  value,
  suffix,
  color,
}: {
  label: string;
  value: string;
  suffix: string;
  color?: string;
}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : undefined]}>
        {value}
        {suffix ? <Text style={styles.metricSuffix}> {suffix}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  poorSignalAlert: {
    backgroundColor: '#F44336',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#D32F2F',
  },
  poorSignalText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  statusMessage: {
    backgroundColor: '#FFA726',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statusText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricBox: {
    flex: 1,
    marginHorizontal: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  metricLabel: {
    color: '#ccc',
    fontSize: 12,
    marginBottom: 4,
  },
  metricValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
  },
  metricSuffix: {
    fontSize: 14,
    color: '#ccc',
  },
  waveform: {
    height: 120,
    borderRadius: 12,
    backgroundColor: '#1d1d1d',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  waveformBar: {
    width: 2,
    marginHorizontal: 1,
    backgroundColor: '#39d353',
    borderRadius: 2,
  },
  waveformBarPick: {
    backgroundColor: '#F44336',
    width: 3,
    borderRadius: 1.5,
  },
  waveformEmpty: {
    color: '#888',
    alignSelf: 'center',
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: '#4caf50',
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  stateLabel: {
    color: '#ccc',
    textAlign: 'center',
  },
});
