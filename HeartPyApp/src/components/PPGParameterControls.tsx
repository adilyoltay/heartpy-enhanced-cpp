import React, {useMemo} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  DEFAULT_ANALYZER_OPTIONS,
  type AnalyzerTuningOptions,
} from '../core/PPGAnalyzer';

type Props = {
  options: AnalyzerTuningOptions;
  onChange: (update: Partial<AnalyzerTuningOptions>) => Promise<void> | void;
  onReset?: () => Promise<void> | void;
  disabled?: boolean;
};

type ControlConfig = {
  key: keyof AnalyzerTuningOptions;
  label: string;
  step: number;
  min: number;
  max: number;
  decimals?: number;
  format?: (value: number) => string;
};

const CONTROL_CONFIG: ControlConfig[] = [
  {
    key: 'thresholdScale',
    label: 'Threshold Scale',
    step: 0.05,
    min: 0.3,
    max: 0.9,
    decimals: 2,
  },
  {
    key: 'pHalfOverFundThresholdSoft',
    label: 'pHalf/Fund Soft',
    step: 0.05,
    min: 0.8,
    max: 1.8,
    decimals: 2,
  },
  {
    key: 'refractoryMs',
    label: 'Refractory (ms)',
    step: 10,
    min: 180,
    max: 400,
    decimals: 0,
    format: value => `${Math.round(value)} ms`,
  },
  {
    key: 'highCutoffHz',
    label: 'High Cutoff (Hz)',
    step: 0.1,
    min: 2.0,
    max: 5.0,
    decimals: 2,
  },
  {
    key: 'welchWsizeSec',
    label: 'Welch Window (s)',
    step: 1,
    min: 4,
    max: 16,
    decimals: 0,
    format: value => `${Math.round(value)} s`,
  },
  {
    key: 'nfft',
    label: 'FFT Size',
    step: 256,
    min: 512,
    max: 4096,
    decimals: 0,
  },
  {
    key: 'snrTauSec',
    label: 'SNR Tau (s)',
    step: 0.5,
    min: 0.5,
    max: 10.0,
    decimals: 2,
    format: value => `${value.toFixed(2)} s`,
  },
  {
    key: 'snrActiveTauSec',
    label: 'SNR Active Tau (s)',
    step: 0.5,
    min: 0.5,
    max: 10.0,
    decimals: 2,
    format: value => `${value.toFixed(2)} s`,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function PPGParameterControls({
  options,
  onChange,
  onReset,
  disabled,
}: Props): JSX.Element {
  const rows = useMemo(
    () =>
      CONTROL_CONFIG.map(config => {
        const baseValue = options[config.key];
        const defaultValue = DEFAULT_ANALYZER_OPTIONS[config.key];
        const value =
          typeof baseValue === 'number'
            ? baseValue
            : (defaultValue as number);

        const displayValue = config.format
          ? config.format(value)
          : value.toFixed(config.decimals ?? 2);

        const adjust = async (direction: -1 | 1) => {
          if (disabled) {
            return;
          }
          const next = clamp(
            Number((value + direction * config.step).toFixed(config.decimals ?? 3)),
            config.min,
            config.max,
          );
          await onChange({[config.key]: next});
        };

        return (
          <View key={config.key as string} style={styles.row}>
            <View style={styles.labelColumn}>
              <Text style={styles.label}>{config.label}</Text>
              <Text style={styles.value}>{displayValue}</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => void adjust(-1)}
                style={[styles.button, styles.decreaseButton, disabled && styles.buttonDisabled]}
                disabled={disabled}>
                <Text style={styles.buttonText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void adjust(1)}
                style={[styles.button, styles.increaseButton, disabled && styles.buttonDisabled]}
                disabled={disabled}>
                <Text style={styles.buttonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }),
    [options, onChange, disabled],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Anlık Ayarlar</Text>
      <Text style={styles.caption}>
        Parametreleri değiştirirken dalga formu ve metriklere göz at. Ayarlar koşarken
        yeniden uygulanır.
      </Text>
      <View style={styles.divider} />
      {rows}
      {typeof onReset === 'function' ? (
        <TouchableOpacity
          onPress={() => void onReset()}
          style={styles.resetButton}
          disabled={disabled}>
          <Text style={styles.resetText}>Varsayılanlara dön</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  heading: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  caption: {
    color: '#9aa0a6',
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#222',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1b1b1b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 16,
  },
  labelColumn: {
    flex: 1,
  },
  label: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '500',
  },
  value: {
    color: '#fff',
    fontSize: 16,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decreaseButton: {
    backgroundColor: '#374151',
  },
  increaseButton: {
    backgroundColor: '#2563eb',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    marginTop: -4,
  },
  resetButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#2d2d2d',
  },
  resetText: {
    color: '#9aa0a6',
    fontSize: 13,
    fontWeight: '500',
  },
});
