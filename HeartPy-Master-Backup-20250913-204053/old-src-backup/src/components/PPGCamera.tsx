import React from 'react';
import { Text } from 'react-native';
import { Camera, type Frame, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import type { PPGSample } from '../types/PPGTypes';
import { PPG_CONFIG } from '../core/PPGConfig';

declare const extractPPGValue: (frame: Frame) => number;

interface Props {
  readonly onSample: (sample: PPGSample) => void;
}

export function PPGCamera({ onSample }: Props): JSX.Element {
  const device = useCameraDevice('back');
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const value = extractPPGValue(frame);
    const timestamp = frame.timestamp ?? Date.now();
    runOnJS(onSample)({ value, timestamp });
  }, [onSample]);

  if (!device) {
    return <Text>No camera available</Text>;
  }

  return (
    <Camera
      style={{ flex: 1 }}
      device={device}
      isActive
      frameProcessor={frameProcessor}
      fps={PPG_CONFIG.camera.fps}
      torch={PPG_CONFIG.camera.torchLevel > 0 ? 'on' : 'off'}
    />
  );
}
