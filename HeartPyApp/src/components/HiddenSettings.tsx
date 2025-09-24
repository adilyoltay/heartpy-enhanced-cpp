import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {PPGParameterControls} from './PPGParameterControls';
import {COLORS} from '../styles/colors';
import {TYPOGRAPHY, TEXT_STYLES} from '../styles/typography';
import {SPACING, LAYOUT} from '../styles/spacing';
import type {AnalyzerTuningOptions} from '../core/PPGAnalyzer';
import {DEFAULT_ANALYZER_OPTIONS} from '../core/PPGAnalyzer';

const {width: screenWidth} = Dimensions.get('window');

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

interface HiddenSettingsProps {
  isVisible: boolean;
  onClose: () => void;
  options: AnalyzerTuningOptions;
  onChange: (options: Partial<AnalyzerTuningOptions>) => void;
  onReset: () => void;
  disabled?: boolean;
}

type ToggleRowProps = {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

const ToggleRow = ({label, hint, value, onChange, disabled}: ToggleRowProps) => (
  <View style={styles.rowContainer}>
    <View style={styles.rowLabelColumn}>
      <Text style={styles.rowLabel}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{false: COLORS.border, true: COLORS.accent}}
      thumbColor={disabled ? COLORS.border : '#fff'}
    />
  </View>
);

type StepperRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  format?: (value: number) => string;
};

const StepperRow = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  format,
}: StepperRowProps) => {
  const display = format ? format(value) : value.toFixed(2);

  const handleAdjust = (direction: -1 | 1) => {
    if (disabled) {
      return;
    }
    const next = clamp(Number((value + direction * step).toFixed(3)), min, max);
    onChange(next);
  };

  return (
    <View style={styles.rowContainer}>
      <View style={styles.rowLabelColumn}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{display}</Text>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity
          style={[styles.rowButton, disabled && styles.rowButtonDisabled]}
          onPress={() => handleAdjust(-1)}
          disabled={disabled}>
          <Text style={styles.rowButtonText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rowButton, disabled && styles.rowButtonDisabled]}
          onPress={() => handleAdjust(1)}
          disabled={disabled}>
          <Text style={styles.rowButtonText}>＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

type SelectRowOption = {
  key: AnalyzerTuningOptions['filterMode'];
  label: string;
};

type SelectRowProps = {
  label: string;
  value: AnalyzerTuningOptions['filterMode'] | undefined;
  options: SelectRowOption[];
  onSelect: (next: AnalyzerTuningOptions['filterMode']) => void;
  disabled?: boolean;
};

const SelectRow = ({label, value, options, onSelect, disabled}: SelectRowProps) => (
  <View style={styles.rowContainerVertical}>
    <Text style={styles.rowLabel}>{label}</Text>
    <View style={styles.selectChipRow}>
      {options.map(option => {
        const isActive = option.key === value;
        return (
          <TouchableOpacity
            key={option.key ?? option.label}
            style={[
              styles.selectChip,
              isActive && styles.selectChipActive,
              disabled && styles.selectChipDisabled,
            ]}
            onPress={() => onSelect(option.key)}
            disabled={disabled}>
            <Text
              style={[
                styles.selectChipText,
                isActive && styles.selectChipTextActive,
              ]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

export const HiddenSettings: React.FC<HiddenSettingsProps> = ({
  isVisible,
  onClose,
  options,
  onChange,
  onReset,
  disabled = false,
}) => {
  const slideAnim = useRef(new Animated.Value(screenWidth)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const thresholdScale = useMemo(() => {
    const value = options.thresholdScale;
    return typeof value === 'number'
      ? value
      : DEFAULT_ANALYZER_OPTIONS.thresholdScale ?? 0.5;
  }, [options.thresholdScale]);

  const refractory = useMemo(() => {
    const value = options.refractoryMs;
    return typeof value === 'number'
      ? value
      : DEFAULT_ANALYZER_OPTIONS.refractoryMs ?? 350;
  }, [options.refractoryMs]);

  const filterMode = options.filterMode ?? DEFAULT_ANALYZER_OPTIONS.filterMode ?? 'auto';
  const filterOrder = options.filterOrder ?? DEFAULT_ANALYZER_OPTIONS.filterOrder ?? 3;

  const advancedKeys: Array<keyof AnalyzerTuningOptions> = useMemo(
    () => [
      'pHalfOverFundThresholdSoft',
      'welchWsizeSec',
      'nfft',
      'highCutoffHz',
      'snrTauSec',
      'snrActiveTauSec',
    ],
    [],
  );

  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0.5,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: screenWidth,
          duration: 250,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setShowAdvanced(false);
      });
    }
  }, [isVisible, overlayOpacity, slideAnim]);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: overlayOpacity,
          },
        ]}
        pointerEvents={isVisible ? 'auto' : 'none'}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          onPress={onClose}
          activeOpacity={1}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.settingsPanel,
          {
            transform: [{translateX: slideAnim}],
          },
        ]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Settings</Text>
            <Text style={styles.sectionCaption}>
              Günlük kullanım için önerilen, güvenli ayarlar.
            </Text>
            <View style={styles.sectionDivider} />
            <ToggleRow
              label="Frequency Domain (LF/HF)"
              hint="LF/HF analizi daha fazla CPU tüketir. Gerekli olduğunda açın."
              value={!!options.calcFreq}
              onChange={value => onChange({calcFreq: value})}
              disabled={disabled}
            />
            <View style={styles.rowSeparator} />
            <StepperRow
              label="Threshold Scale"
              value={thresholdScale}
              min={0.3}
              max={0.9}
              step={0.05}
              disabled={disabled}
              format={value => value.toFixed(2)}
              onChange={next => onChange({thresholdScale: next})}
            />
            <View style={styles.rowSeparator} />
            <StepperRow
              label="Refractory (ms)"
              value={refractory}
              min={180}
              max={400}
              step={10}
              disabled={disabled}
              format={value => `${Math.round(value)} ms`}
              onChange={next => onChange({refractoryMs: Math.round(next)})}
            />
            <View style={styles.rowSeparator} />
            <SelectRow
              label="Filter Mode"
              value={filterMode}
              options={[
                {key: 'auto', label: 'Auto'},
                {key: 'butter-filtfilt', label: 'Butter (Zero-phase)'},
              ]}
              onSelect={next => onChange({filterMode: next})}
              disabled={disabled}
            />
            <View style={styles.rowSeparator} />
            <StepperRow
              label="Filter Order"
              value={filterOrder}
              min={1}
              max={4}
              step={1}
              disabled={disabled}
              format={value => `Order ${Math.round(value)}`}
              onChange={next => onChange({filterOrder: Math.round(next)})}
            />
          </View>

          <View style={styles.sectionSpacing} />

          <TouchableOpacity
            style={styles.accordionHeader}
            onPress={() => setShowAdvanced(prev => !prev)}>
            <View>
              <Text style={styles.sectionTitle}>Advanced Settings</Text>
              <Text style={styles.sectionCaption}>
                Uzman ayarlar. CPU/pil kullanımını artırabilir.
              </Text>
            </View>
            <Text style={styles.accordionChevron}>{showAdvanced ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showAdvanced ? (
            <View style={styles.advancedContainer}>
              <PPGParameterControls
                title="Advanced Analyzer"
                caption="Detaylı kontroller. Değişiklikler ölçüm sırasında yeniden uygulanır."
                showCalcFreqToggle={false}
                includeKeys={advancedKeys}
                options={options}
                onChange={onChange}
                onReset={onReset}
                disabled={disabled}
              />
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 100,
  },
  overlayTouchable: {
    flex: 1,
  },
  settingsPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: screenWidth * 0.85,
    backgroundColor: COLORS.surface,
    zIndex: 101,
    ...LAYOUT.shadows.medium,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    ...TEXT_STYLES.label,
    color: COLORS.textSecondary,
  },
  content: {
    flex: 1,
    padding: SPACING.md,
  },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: LAYOUT.borderRadius.medium,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
    ...LAYOUT.shadows.subtle,
  },
  sectionTitle: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
  sectionCaption: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  sectionSpacing: {
    height: SPACING.lg,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  rowContainerVertical: {
    gap: SPACING.sm,
  },
  rowLabelColumn: {
    flex: 1,
  },
  rowLabel: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
  rowHint: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  rowValue: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  rowButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rowButtonDisabled: {
    opacity: 0.4,
  },
  rowButtonText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
  },
  rowSeparator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.xs,
  },
  selectChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  selectChip: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: LAYOUT.borderRadius.large,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  selectChipDisabled: {
    opacity: 0.5,
  },
  selectChipText: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
  },
  selectChipTextActive: {
    color: COLORS.textInverse,
  },
  accordionHeader: {
    backgroundColor: COLORS.surface,
    borderRadius: LAYOUT.borderRadius.medium,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...LAYOUT.shadows.subtle,
  },
  accordionChevron: {
    ...TEXT_STYLES.label,
    color: COLORS.textSecondary,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
  advancedContainer: {
    marginTop: SPACING.md,
  },
});
