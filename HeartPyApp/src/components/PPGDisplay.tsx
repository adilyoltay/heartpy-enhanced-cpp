import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {PPG_CONFIG} from '../core/PPGConfig';
import type {PPGAnalysisFrame, PPGState} from '../types/PPGTypes';
import SkiaWaveform from './SkiaWaveform';
import {COLORS, getBpmColor, getConfidenceColor} from '../styles/colors';
import {TYPOGRAPHY, TEXT_STYLES} from '../styles/typography';
import {SPACING, LAYOUT} from '../styles/spacing';
import {useResponsive} from '../styles/responsive';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// Bu component artık doğrudan C++'tan gelen senkronize edilmiş
// dalga formu snapshot'ını render eder.
type Props = {
  data: PPGAnalysisFrame; // Gelen veri artık tam bir analiz çerçevesi
  state: PPGState;
  onStart: () => void;
  onStop: () => void;
};

const MAX_WAVEFORM_POINTS = 240;

// Minimalist Metric Card - sade ve sakin
type MinimalMetricCardProps = {
  label: string;
  value: string;
  valueColor?: string;
  fontSizeOverride?: number;
  containerWidth?: number | `${number}%`;
  containerMaxWidth?: number;
};

const MinimalMetricCard = React.memo(
  ({
    label,
    value,
    valueColor,
    fontSizeOverride,
    containerWidth,
    containerMaxWidth,
  }: MinimalMetricCardProps) => {
    const isConfidence = label === 'Confidence';
    const valueStyle = isConfidence
      ? styles.minimalConfidenceValue
      : styles.minimalBpmValue;

    return (
      <View
        style={[
          styles.minimalMetricCard,
          containerWidth ? {width: containerWidth} : null,
          containerMaxWidth ? {maxWidth: containerMaxWidth} : null,
        ]}>
        <Text style={styles.minimalMetricLabel}>{label}</Text>
        <Text
          style={[
            valueStyle,
            fontSizeOverride ? {fontSize: fontSizeOverride} : null,
            {color: valueColor || COLORS.text},
          ]}>
          {value}
        </Text>
      </View>
    );
  },
  (prev, next) =>
    prev.label === next.label &&
    prev.value === next.value &&
    prev.valueColor === next.valueColor &&
    prev.fontSizeOverride === next.fontSizeOverride &&
    prev.containerWidth === next.containerWidth &&
    prev.containerMaxWidth === next.containerMaxWidth,
);

const PPGDisplayComponent = ({
  data,
  state,
  onStart,
  onStop,
}: Props): JSX.Element => {
  const r = useResponsive();
  const {metrics, waveform, warmupProgress} = data;
  const isIdle = state === 'idle';
  const isStarting = state === 'starting';

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

  const collapseThreshold = PPG_CONFIG.ui?.confidenceCollapseThreshold ?? 0.95;
  const collapseEnabled =
    Boolean(PPG_CONFIG.ui?.progressiveDisclosure) &&
    collapseThreshold > 0 &&
    collapseThreshold < 1;
  const collapseHysteresis = 0.02;
  const stabilityPolls = 3;
  const stabilityMs = 3_000;
  const reopenCooldownMs = 500;
  const [isConfidenceCollapsed, setIsConfidenceCollapsed] = useState(false);
  const stableSinceRef = useRef<number | null>(null);
  const consecutiveGoodRef = useRef(0);
  const lastDecisionRef = useRef(0);

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
    const verboseLogging = Boolean(PPG_CONFIG.debug.enableDetailedSnrLogging);
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
        : metrics.snrDb ?? -10;
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

    lastHapticPeakTsRef.current = latestPeakTs;
    lastHapticTimeRef.current = now;
  }, [metrics, state]);

  // --- GÜNCEL ve BASİTLEŞTİRİLMİŞ MARKER MANTIĞI ---
  const peakTimestampSet = useMemo(() => {
    // Gelen metriklerdeki tepe noktası zaman damgalarını bir Set'e koy
    return new Set<number>(metrics?.peakTimestamps || []);
  }, [metrics]);

  const displayWaveform = useMemo(() => {
    if (!waveform || waveform.length <= MAX_WAVEFORM_POINTS) {
      return waveform;
    }
    const stride = Math.ceil(waveform.length / MAX_WAVEFORM_POINTS);
    const sampled: Array<{value: number; timestamp: number}> = [];
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
    const bpmRaw = metrics?.bpm;
    const snrRaw = metrics?.snrDb ?? metrics?.quality?.snrDb;
    const confidenceRaw = metrics?.confidence ?? metrics?.quality?.confidence;
    const bpmNumber = isFiniteNumber(bpmRaw) ? bpmRaw : undefined;
    const snrNumber = isFiniteNumber(snrRaw) ? snrRaw : undefined;
    const confidenceNumber = isFiniteNumber(confidenceRaw)
      ? confidenceRaw
      : undefined;

    return {
      bpmNumber,
      snrNumber,
      confidenceNumber,
      bpmText: bpmNumber !== undefined ? bpmNumber.toFixed(1) : '--',
      snrText: snrNumber !== undefined ? snrNumber.toFixed(2) : '--',
      confidenceText:
        confidenceNumber !== undefined ? confidenceNumber.toFixed(2) : '--',
    };
  }, [
    metrics?.bpm,
    metrics?.confidence,
    metrics?.quality?.confidence,
    metrics?.quality?.snrDb,
    metrics?.snrDb,
  ]);

  useEffect(() => {
    if (!collapseEnabled) {
      if (isConfidenceCollapsed) {
        setIsConfidenceCollapsed(false);
      }
      stableSinceRef.current = null;
      consecutiveGoodRef.current = 0;
      return;
    }

    const confidence = metricsViewModel.confidenceNumber;
    const snr = metricsViewModel.snrNumber;
    const signalQuality =
      metrics?.signalQuality ?? metrics?.quality?.signalQuality ?? 'unknown';

    const goodQuality =
      state === 'running' &&
      signalQuality === 'good' &&
      isFiniteNumber(confidence) &&
      isFiniteNumber(snr) &&
      snr >= (PPG_CONFIG.snrDbThresholdUI ?? -Infinity);

    if (!goodQuality || !isFiniteNumber(confidence) || !isFiniteNumber(snr)) {
      consecutiveGoodRef.current = 0;
      stableSinceRef.current = null;
      if (isConfidenceCollapsed) {
        setIsConfidenceCollapsed(false);
        lastDecisionRef.current = Date.now();
      }
      return;
    }

    const now = Date.now();
    const upper = collapseThreshold;
    const lower = collapseThreshold - collapseHysteresis;
    const lastDecisionAgo = now - lastDecisionRef.current;

    if (confidence >= upper) {
      consecutiveGoodRef.current += 1;
      if (stableSinceRef.current == null) {
        stableSinceRef.current = now;
      }
      const stableDuration = now - stableSinceRef.current;
      if (
        !isConfidenceCollapsed &&
        (consecutiveGoodRef.current >= stabilityPolls ||
          stableDuration >= stabilityMs)
      ) {
        setIsConfidenceCollapsed(true);
        lastDecisionRef.current = now;
      }
    } else if (confidence <= lower) {
      consecutiveGoodRef.current = 0;
      stableSinceRef.current = null;
      if (isConfidenceCollapsed && lastDecisionAgo >= reopenCooldownMs) {
        setIsConfidenceCollapsed(false);
        lastDecisionRef.current = now;
      }
    }
  }, [
    collapseEnabled,
    collapseThreshold,
    metrics?.quality?.signalQuality,
    metrics?.signalQuality,
    metricsViewModel.confidenceNumber,
    metricsViewModel.snrNumber,
    isConfidenceCollapsed,
    state,
  ]);

  const confidencePercentText = useMemo(() => {
    if (!isFiniteNumber(metricsViewModel.confidenceNumber)) {
      return '--';
    }
    return `${(metricsViewModel.confidenceNumber * 100).toFixed(1)}%`;
  }, [metricsViewModel.confidenceNumber]);

  const showConfidenceCard = !collapseEnabled || !isConfidenceCollapsed;

  const primaryMetrics = useMemo(() => {
    const cards = [
      {
        key: 'bpm',
        label: 'Heart Rate',
        value:
          metricsViewModel.bpmNumber !== undefined
            ? `${metricsViewModel.bpmText} BPM`
            : '--',
        valueColor: getBpmColor(metricsViewModel.bpmNumber ?? 0),
      },
    ];

    if (showConfidenceCard) {
      cards.push({
        key: 'confidence',
        label: 'Confidence',
        value: confidencePercentText,
        valueColor: getConfidenceColor(
          metricsViewModel.confidenceNumber ?? 0,
        ),
      });
    }

    return cards;
  }, [
    confidencePercentText,
    metricsViewModel.bpmNumber,
    metricsViewModel.bpmText,
    metricsViewModel.confidenceNumber,
    showConfidenceCard,
  ]);

  const confidenceBadgeText = showConfidenceCard ? null : confidencePercentText;

  const detailMetrics = useMemo(() => {
    const formatValue = (value: number | null | undefined, formatter: (val: number) => string) =>
      isFiniteNumber(value) ? formatter(value) : '--';

    return [
      {key: 'snr', label: 'SNR (dB)', value: metricsViewModel.snrText},
      {
        key: 'sdnn',
        label: 'SDNN',
        value: formatValue(metrics?.sdnn, val => `${val.toFixed(0)} ms`),
      },
      {
        key: 'rmssd',
        label: 'RMSSD',
        value: formatValue(metrics?.rmssd, val => `${val.toFixed(0)} ms`),
      },
      {
        key: 'pnn50',
        label: 'pNN50',
        value: formatValue(metrics?.pnn50, val => `${(val * 100).toFixed(0)}%`),
      },
      {
        key: 'lfhf',
        label: 'LF/HF',
        value: formatValue(metrics?.lfhf, val => val.toFixed(2)),
      },
    ];
  }, [
    metrics?.lfhf,
    metrics?.pnn50,
    metrics?.rmssd,
    metrics?.sdnn,
    metricsViewModel.snrText,
  ]);

  const showBreathingGuide = useMemo(() => {
    if (!PPG_CONFIG.ui?.breathingGuide) {
      return false;
    }
    if (state !== 'running') {
      return false;
    }
    const confidence = metricsViewModel.confidenceNumber;
    if (!isFiniteNumber(confidence) || confidence < 0.7) {
      return false;
    }
    const snr = metricsViewModel.snrNumber;
    if (!isFiniteNumber(snr) || snr <= (PPG_CONFIG.snrDbThresholdUI ?? -Infinity)) {
      return false;
    }
    return true;
  }, [metricsViewModel.confidenceNumber, metricsViewModel.snrNumber, state]);

  const _hrvMetricsViewModel = useMemo(() => {
    const toMs = (value?: number, decimals = 0) =>
      isFiniteNumber(value) ? `${value.toFixed(decimals)} ms` : '--';
    const toPercent = (value?: number) =>
      isFiniteNumber(value) ? `${(value * 100).toFixed(1)}%` : '--';
    const toRatio = (value?: number) =>
      isFiniteNumber(value) ? value.toFixed(2) : '--';
    const toBreathsPerMinute = (value?: number) =>
      isFiniteNumber(value) ? `${(value * 60).toFixed(1)} brpm` : '--';

    return [
      {key: 'sdnn', label: 'SDNN', value: toMs(metrics?.sdnn)},
      {key: 'rmssd', label: 'RMSSD', value: toMs(metrics?.rmssd)},
      {key: 'sdsd', label: 'SDSD', value: toMs(metrics?.sdsd)},
      {key: 'pnn20', label: 'pNN20', value: toPercent(metrics?.pnn20)},
      {key: 'pnn50', label: 'pNN50', value: toPercent(metrics?.pnn50)},
      {key: 'lfhf', label: 'LF/HF', value: toRatio(metrics?.lfhf)},
      {
        key: 'breathingRate',
        label: 'Breathing Rate',
        value: toBreathsPerMinute(metrics?.breathingRate),
      },
    ];
  }, [
    metrics?.sdnn,
    metrics?.rmssd,
    metrics?.sdsd,
    metrics?.pnn20,
    metrics?.pnn50,
    metrics?.lfhf,
    metrics?.breathingRate,
  ]);

  // Responsive derived sizes
  const bpmFontSize = r.ms(TYPOGRAPHY.fontSizes.large, r.isTablet ? 0.5 : 0.35);
  const confidenceFontSize = r.ms(
    TYPOGRAPHY.fontSizes.medium,
    r.isTablet ? 0.45 : 0.35,
  );
  const waveformHeight = r.isTablet
    ? (r.isLandscape ? Math.max(220, Math.round(r.height * 0.35)) : 220)
    : (r.isLandscape ? 180 : 160);
  const cardMaxWidth = r.isTablet ? 420 : 320;
  const cardWidthPct: `${number}%` = r.isTablet ? '65%' : '80%';
  const detailCardBasis: `${number}%` = r.isTablet ? '30%' : '45%';
  const strokeWidth = r.isTablet ? 3 : 2;

  return (
    <View style={styles.minimalContainer}>
      {/* Minimalist Metrics - sadece BPM ve Confidence */}
      <View style={styles.minimalMetricsContainer}>
        {primaryMetrics.map(metric => (
          <MinimalMetricCard
            key={metric.key}
            label={metric.label}
            value={metric.value}
            valueColor={metric.valueColor}
            fontSizeOverride={
              metric.key === 'bpm' ? bpmFontSize : confidenceFontSize
            }
            containerWidth={cardWidthPct}
            containerMaxWidth={cardMaxWidth}
          />
        ))}
        {confidenceBadgeText ? (
          <Text style={styles.confidenceBadge}>Confidence {confidenceBadgeText}</Text>
        ) : null}
      </View>

      {/* Warm-up Progress Bar */}
      {warmupProgress?.isWarmingUp && (
        <View style={styles.warmupContainer}>
          <Text style={styles.warmupText}>
            Initializing... {warmupProgress.progress.toFixed(0)}%
          </Text>
          <View style={styles.warmupProgressBar}>
            {(() => {
              const boundedProgress = Math.min(
                100,
                Math.max(0, warmupProgress.progress ?? 0),
              );
              const widthPercent = `${boundedProgress}%` as `${number}%`;
              return (
                <View
                  style={[
                    styles.warmupProgressFill,
                    {width: widthPercent},
                  ]}
                />
              );
            })()}
          </View>
          <Text style={styles.warmupSubtext}>
            {warmupProgress.samplesPushed} / {warmupProgress.samplesRequired} samples
          </Text>
        </View>
      )}

      <View style={styles.detailSection}>
        <Text style={styles.detailTitle}>Advanced Metrics</Text>
        <View style={styles.detailMetricsGrid}>
          {detailMetrics.map(metric => (
            <View
              key={metric.key}
              style={[
                styles.detailMetricCard,
                {flexBasis: detailCardBasis, maxWidth: 240},
              ]}>
              <Text style={styles.detailMetricLabel}>{metric.label}</Text>
              <Text style={styles.detailMetricValue}>{metric.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Waveform - minimal ve sakin */}
      <View style={[styles.minimalWaveform, {height: waveformHeight, width: '92%'}]}>
        <SkiaWaveform
          points={waveformPoints}
          peaks={peakTimestampSet}
          strokeWidth={strokeWidth}
        />
      </View>

      {showBreathingGuide ? <_BreathingGuide /> : null}

      {/* Start/Stop Button - minimal */}
      <View style={styles.minimalControls}>
        <TouchableOpacity
          onPress={isIdle ? onStart : onStop}
          disabled={isStarting}
          style={[
            styles.minimalButton,
            isIdle ? styles.minimalStartButton : styles.minimalStopButton,
            isStarting && styles.minimalButtonDisabled,
          ]}>
          <Text style={styles.minimalButtonText}>
            {isIdle ? 'Start' : 'Stop'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const PPGDisplay = React.memo(PPGDisplayComponent);

// Simple, subtle breathing guide (inhale/exhale) for relaxation
const _BreathingGuide = () => {
  const anim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = () => {
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 4000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 4000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(({finished}) => {
        if (finished) {
          loop();
        }
      });
    };
    loop();
  }, [anim]);

  const scale = anim.interpolate({inputRange: [0, 1], outputRange: [0.9, 1.1]});
  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.9],
  });

  return (
    <View style={breathingStyles.breathingWrapper}>
      <Animated.View
        style={[breathingStyles.breathingDot, {transform: [{scale}], opacity}]}
      />
      <Text style={breathingStyles.breathingText}>Breathe</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  // Minimalist Container
  minimalContainer: {
    flex: 1,
    padding: SPACING.md,
    backgroundColor: COLORS.background,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: SPACING.xxl,
  },

  // Minimalist Metrics
  minimalMetricsContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    width: '100%',
    justifyContent: 'center',
  },

  confidenceBadge: {
    marginTop: SPACING.sm,
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
  },

  minimalMetricCard: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderRadius: LAYOUT.borderRadius.large,
    width: '80%',
    maxWidth: 360,
    ...LAYOUT.shadows.subtle,
  },

  minimalMetricLabel: {
    ...TEXT_STYLES.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },

  minimalMetricValue: {
    ...TEXT_STYLES.bpmValue,
    color: COLORS.text,
    textAlign: 'center',
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
  },

  minimalBpmValue: {
    // will be overridden responsively in-line where used
    fontSize: TYPOGRAPHY.fontSizes.large,
    color: COLORS.text,
    textAlign: 'center',
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
    lineHeight: TYPOGRAPHY.fontSizes.large * TYPOGRAPHY.lineHeights.tight,
  },

  minimalConfidenceValue: {
    // will be overridden responsively in-line where used
    fontSize: TYPOGRAPHY.fontSizes.medium,
    color: COLORS.text,
    textAlign: 'center',
    fontWeight: TYPOGRAPHY.fontWeights.medium,
    lineHeight: TYPOGRAPHY.fontSizes.medium * TYPOGRAPHY.lineHeights.normal,
  },

  // Minimalist Waveform
  minimalWaveform: {
    height: 160,
    width: '92%',
    borderRadius: LAYOUT.borderRadius.medium,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.xl,
    ...LAYOUT.shadows.subtle,
    overflow: 'hidden',
  },

  // Minimalist Controls
  minimalControls: {
    alignItems: 'center',
  },

  minimalButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: LAYOUT.borderRadius.large,
    alignItems: 'center',
    minWidth: 140,
    ...LAYOUT.shadows.medium,
  },

  minimalStartButton: {
    backgroundColor: COLORS.success,
  },

  minimalStopButton: {
    backgroundColor: COLORS.error,
  },

  minimalButtonDisabled: {
    opacity: 0.4,
  },

  minimalButtonText: {
    ...TEXT_STYLES.label,
    color: COLORS.textInverse,
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
    fontSize: 18,
  },

  // Warm-up Progress Bar Styles
  warmupContainer: {
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: LAYOUT.borderRadius.medium,
    ...LAYOUT.shadows.subtle,
  },

  warmupText: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },

  warmupProgressBar: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },

  warmupProgressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },

  warmupSubtext: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  detailSection: {
    width: '100%',
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
  },

  detailTitle: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },

  detailMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'center',
  },

  detailMetricCard: {
    minWidth: 120,
    flexGrow: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: LAYOUT.borderRadius.medium,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    ...LAYOUT.shadows.subtle,
  },

  detailMetricLabel: {
    ...TEXT_STYLES.secondary,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },

  detailMetricValue: {
    ...TEXT_STYLES.label,
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
});

const breathingStyles = StyleSheet.create({
  breathingWrapper: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  breathingDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4aa3ff',
    marginBottom: 4,
  },
  breathingText: {
    color: '#999',
    fontSize: 12,
  },
});
