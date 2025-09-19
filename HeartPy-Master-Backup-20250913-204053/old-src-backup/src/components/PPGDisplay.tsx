import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PPGMetrics, PPGState } from '../types/PPGTypes';
import { PPG_CONFIG } from '../core/PPGConfig';

interface Props {
  readonly metrics: PPGMetrics | null;
  readonly state: PPGState;
  readonly waveform: readonly number[];
  readonly onStart: () => void;
  readonly onStop: () => void;
}

export function PPGDisplay({ metrics, state, waveform, onStart, onStop }: Props): JSX.Element {
  const isRunning = state === 'running' || state === 'starting';
  const action = isRunning ? onStop : onStart;
  const label = isRunning ? 'Stop' : 'Start';

  return (
    <View style={styles.container}>
      <MetricsBlock metrics={metrics} state={state} />
      <WaveformBlock waveform={waveform} />
      <TouchableOpacity style={[styles.button, isRunning && styles.stopButton]} onPress={action}>
        <Text style={styles.buttonText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function MetricsBlock({ metrics, state }: { readonly metrics: PPGMetrics | null; readonly state: PPGState }): JSX.Element {
  return (
    <View style={styles.metrics}>
      <Text style={styles.bpm}>{metrics?.bpm ?? '--'} BPM</Text>
      <MetricLine label="Confidence" value={formatNumber(metrics?.confidence ?? 0, 2)} />
      <MetricLine label="SNR" value={`${formatNumber(metrics?.snr ?? 0, 1)} dB`} />
      <MetricLine label="Quality" value={metrics?.quality ?? 'unknown'} />
      <MetricLine label="State" value={state} />
    </View>
  );
}

function MetricLine({ label, value }: { readonly label: string; readonly value: string | number }): JSX.Element {
  return (
    <Text style={styles.metricText}>
      {label}: {value}
    </Text>
  );
}

function WaveformBlock({ waveform }: { readonly waveform: readonly number[] }): JSX.Element {
  const slice = waveform.slice(-PPG_CONFIG.ui.waveformSamples);
  return (
    <View style={styles.waveform}>
      {slice.map((value, index) => {
        const height = 40 + Math.min(Math.abs(value) * 80, 80);
        return <View key={index} style={[styles.waveformBar, { height }]} />;
      })}
    </View>
  );
}

function formatNumber(value: number, fractionDigits: number): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : '--';
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#111' },
  metrics: { marginBottom: 12 },
  bpm: { fontSize: 48, color: '#fff', fontWeight: 'bold' },
  metricText: { color: '#ccc', marginTop: 4 },
  waveform: {
    height: 100,
    backgroundColor: '#222',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  waveformBar: { width: 2, marginHorizontal: 1, backgroundColor: '#f44336', borderRadius: 1 },
  button: {
    backgroundColor: '#4caf50',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  stopButton: { backgroundColor: '#f44336' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
