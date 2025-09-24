import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ViewStyle} from 'react-native';
import {COLORS} from '../styles/colors';
import {TYPOGRAPHY, TEXT_STYLES} from '../styles/typography';
import {SPACING, LAYOUT} from '../styles/spacing';
import type {Breakpoint} from '../styles/responsive';

export type PrimaryMetricsCardProps = {
  bpm?: number;
  bpmText: string;
  confidenceText: string;
  bpmColor: string;
  confidenceColor: string;
  showConfidence: boolean;
  breakpoint: Breakpoint;
  isLandscape: boolean;
  ms: (size: number, factor?: number) => number;
};

export const PrimaryMetricsCard: React.FC<PrimaryMetricsCardProps> = ({
  bpmText,
  confidenceText,
  bpmColor,
  confidenceColor,
  showConfidence,
  breakpoint,
  isLandscape,
  ms,
}) => {
  const isTabletLayout = breakpoint === 'lg' || breakpoint === 'xl';
  const useRowLayout = isTabletLayout || isLandscape;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: useRowLayout ? 'row' : 'column',
      alignItems: useRowLayout ? 'center' : 'flex-start',
      justifyContent: useRowLayout ? 'space-between' : 'flex-start',
      borderRadius: LAYOUT.borderRadius.large,
      backgroundColor: COLORS.surface,
      paddingVertical: ms(SPACING.sm),
      paddingHorizontal: ms(SPACING.md),
      ...LAYOUT.shadows.subtle,
    }),
    [ms, useRowLayout],
  );

  const bpmFontSize = useMemo(
    () => ms(TYPOGRAPHY.fontSizes.large, isTabletLayout ? 0.6 : 0.4),
    [isTabletLayout, ms],
  );

  const bpmSpacingStyle = useMemo<ViewStyle>(
    () =>
      useRowLayout
        ? {marginRight: ms(SPACING.sm)}
        : {marginBottom: ms(SPACING.sm)},
    [ms, useRowLayout],
  );

  const confidenceBadgePadding = useMemo(
    () => ({
      paddingHorizontal: ms(12),
      paddingVertical: ms(6),
    }),
    [ms],
  );

  const confidenceAlignment = useMemo<ViewStyle>(
    () => ({alignSelf: useRowLayout ? 'center' : 'flex-start'}),
    [useRowLayout],
  );

  return (
    <View style={containerStyle} testID="primary-metrics-card">
      <View style={[styles.bpmColumn, bpmSpacingStyle]}>
        <Text
          testID="primary-metrics-bpm"
          style={[
            styles.bpmValue,
            {color: bpmColor, fontSize: bpmFontSize},
          ]}
          accessibilityLabel="Heart rate">
          {bpmText}
        </Text>
        {bpmText !== '--' ? (
          <Text style={styles.bpmLabel}>BPM</Text>
        ) : null}
      </View>

      {showConfidence ? (
        <View
          style={[
            styles.confidenceBadge,
            confidenceBadgePadding,
            confidenceAlignment,
            {borderColor: confidenceColor},
          ]}
          testID="primary-metrics-confidence">
          <Text
            style={[
              styles.confidenceLabel,
              {color: confidenceColor},
            ]}
            accessibilityLabel="Confidence level">
            Confidence {confidenceText}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  bpmColumn: {
    flexDirection: 'column',
  },
  bpmValue: {
    fontWeight: TYPOGRAPHY.fontWeights.semibold,
    textAlign: 'left',
    lineHeight: TYPOGRAPHY.fontSizes.large * TYPOGRAPHY.lineHeights.tight,
  },
  bpmLabel: {
    ...TEXT_STYLES.secondary,
    marginTop: SPACING.xs,
    color: COLORS.textSecondary,
  },
  confidenceBadge: {
    borderRadius: LAYOUT.borderRadius.medium,
    borderWidth: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  confidenceLabel: {
    ...TEXT_STYLES.label,
    fontWeight: TYPOGRAPHY.fontWeights.medium,
  },
});
