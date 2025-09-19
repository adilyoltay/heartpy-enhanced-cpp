import React, {useEffect, useRef} from 'react';
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
  const bpm = metrics ? metrics.bpm.toFixed(1) : '--';
  const confidence = metrics ? (metrics.confidence * 100).toFixed(0) : '--';
  const snr = metrics ? metrics.snrDb.toFixed(1) : '--';
  const quality = metrics ? metrics.quality.signalQuality : 'unknown';
  
  // Pick detection and haptic feedback
  const lastBpmRef = useRef<number | null>(null);
  const lastPickTimeRef = useRef<number>(0);
  
  useEffect(() => {
    if (metrics && metrics.bpm > 0 && state === 'running') {
      const currentBpm = metrics.bpm;
      const currentTime = Date.now();
      
      // Detect heart beat (BPM change or new valid reading)
      if (lastBpmRef.current !== null && currentBpm !== lastBpmRef.current) {
        const timeSinceLastPick = currentTime - lastPickTimeRef.current;
        const expectedInterval = 60000 / currentBpm; // ms between beats
        
        // Only trigger haptic if enough time has passed (avoid double triggers)
        if (timeSinceLastPick > expectedInterval * 0.8) {
          ReactNativeHapticFeedback.trigger('impactLight', {
            enableVibrateFallback: true,
            ignoreAndroidSystemSettings: false,
          });
          lastPickTimeRef.current = currentTime;
          console.log('💓 Heart beat detected - BPM:', currentBpm, 'Haptic triggered');
        }
      }
      
      lastBpmRef.current = currentBpm;
    }
  }, [metrics, state]);
  
  // Use HeartPy peakList directly (no duplication)
  const pickPoints = metrics?.peakList || [];

  return (
    <View style={styles.container}>
      <View style={styles.metricsRow}>
        <Metric label="BPM" value={bpm} suffix="" />
        <Metric label="Güven" value={confidence} suffix="%" />
        <Metric label="SNR" value={snr} suffix="dB" />
        <Metric label="Kalite" value={quality.toUpperCase()} suffix="" />
      </View>

      <View style={styles.waveform}>
        {waveform.length === 0 ? (
          <Text style={styles.waveformEmpty}>Örnek bekleniyor…</Text>
        ) : (() => {
          // OPTIMIZATION: Precompute min/max to avoid O(n²) in map
          const waveformSlice = waveform.slice(-PPG_CONFIG.ui.waveformSamples);
          const min = Math.min(...waveformSlice);
          const max = Math.max(...waveformSlice);
          const span = max - min || 1;
          
          return waveformSlice.map((value, index) => {
            const height = ((value - min) / span) * 80 + 4;
            
            // Check if this index corresponds to a HeartPy peak
            // HeartPy peakList contains absolute sample indices
            // We need to map them to our relative waveform indices
            const waveformStart = Math.max(0, waveform.length - PPG_CONFIG.ui.waveformSamples);
            const absoluteIndex = waveformStart + index;
            const isPickPoint = pickPoints.includes(absoluteIndex);
            
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
}: {
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>
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
