import React, {useMemo} from 'react';
import {StyleSheet, Switch, Text, TouchableOpacity, View} from 'react-native';
import {
  DEFAULT_ANALYZER_OPTIONS,
  type AnalyzerTuningOptions,
} from '../core/PPGAnalyzer';
import {COLORS} from '../styles/colors';
import {TYPOGRAPHY, TEXT_STYLES} from '../styles/typography';
import {SPACING, LAYOUT} from '../styles/spacing';

type Props = {
  options: AnalyzerTuningOptions;
  onChange: (update: Partial<AnalyzerTuningOptions>) => Promise<void> | void;
  onReset?: () => Promise<void> | void;
  disabled?: boolean;
  includeKeys?: ReadonlyArray<keyof AnalyzerTuningOptions>;
  title?: string;
  caption?: string;
  showCalcFreqToggle?: boolean;
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
  includeKeys,
  title,
  caption,
  showCalcFreqToggle = true,
}: Props): JSX.Element {
  const configs = useMemo(() => {
    if (!includeKeys || includeKeys.length === 0) {
      return CONTROL_CONFIG;
    }
    const allowed = new Set(includeKeys);
    return CONTROL_CONFIG.filter(config => allowed.has(config.key));
  }, [includeKeys]);

  const rows = useMemo(
    () =>
      configs.map(config => {
        const baseValue = options[config.key];
        const defaultValue = DEFAULT_ANALYZER_OPTIONS[config.key];
        const value =
          typeof baseValue === 'number' ? baseValue : (defaultValue as number);

        const displayValue = config.format
          ? config.format(value)
          : value.toFixed(config.decimals ?? 2);

        const adjust = async (direction: -1 | 1) => {
          if (disabled) {
            return;
          }
          const next = clamp(
            Number(
              (value + direction * config.step).toFixed(config.decimals ?? 3),
            ),
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
                style={[
                  styles.button,
                  styles.decreaseButton,
                  disabled && styles.buttonDisabled,
                ]}
                disabled={disabled}>
                <Text style={styles.buttonText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void adjust(1)}
                style={[
                  styles.button,
                  styles.increaseButton,
                  disabled && styles.buttonDisabled,
                ]}
                disabled={disabled}>
                <Text style={styles.buttonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }),
    [configs, options, onChange, disabled],
  );

  const headingLabel = title ?? 'Anlık Ayarlar';
  const captionLabel =
    caption ??
    'Parametreleri değiştirirken dalga formu ve metriklere göz at. Ayarlar koşarken yeniden uygulanır.';

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{headingLabel}</Text>
      <Text style={styles.caption}>{captionLabel}</Text>
      {showCalcFreqToggle ? (
        <>
          <View style={styles.divider} />
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabelColumn}>
              <Text style={styles.label}>Frequency Domain (LF/HF)</Text>
              <Text style={styles.toggleCaption}>
                LF/HF analizi daha fazla CPU tüketir. Gerekli olduğunda açın.
              </Text>
            </View>
            <Switch
              value={!!options.calcFreq}
              onValueChange={value => onChange({calcFreq: value})}
              disabled={disabled}
              trackColor={{false: '#555', true: '#4caf50'}}
              thumbColor={disabled ? '#777' : '#fff'}
            />
          </View>
        </>
      ) : null}
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
    backgroundColor: COLORS.surface,
    borderRadius: LAYOUT.borderRadius.medium,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
    ...LAYOUT.shadows.subtle,
  },

  heading: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },

  caption: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    lineHeight: TYPOGRAPHY.lineHeights.normal,
  },

  divider: {
    height: 1,
    backgroundColor: COLORS.border,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },

  toggleLabelColumn: {
    flex: 1,
  },

  toggleCaption: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.background,
    borderRadius: LAYOUT.borderRadius.small,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },

  labelColumn: {
    flex: 1,
  },

  label: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },

  value: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    marginTop: SPACING.xs,
  },

  actions: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },

  button: {
    width: 44,
    height: 44,
    borderRadius: LAYOUT.borderRadius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },

  decreaseButton: {
    backgroundColor: COLORS.secondary,
  },

  increaseButton: {
    backgroundColor: COLORS.primary,
  },

  buttonDisabled: {
    opacity: 0.4,
  },

  buttonText: {
    ...TEXT_STYLES.label,
    color: COLORS.textInverse,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
    marginTop: -4,
  },

  resetButton: {
    marginTop: SPACING.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: LAYOUT.borderRadius.small,
    backgroundColor: COLORS.background,
  },

  resetText: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
});
