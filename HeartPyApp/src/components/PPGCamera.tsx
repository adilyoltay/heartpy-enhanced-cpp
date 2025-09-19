import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {NativeEventEmitter, NativeModules, Platform, StyleSheet, Text, View} from 'react-native';
import {
  Camera,
  type Frame,
  type FrameProcessorPlugin,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import {Worklets} from 'react-native-worklets-core';
import {PPG_CONFIG} from '../core/PPGConfig';
import type {PPGSample} from '../types/PPGTypes';

const {PPGCameraManager} = NativeModules;

type Props = {
  onSample: (sample: PPGSample) => void;
  isActive: boolean;
  onFpsUpdate?: (fps: number) => void; // FPS callback for dynamic sampleRate
};

export function PPGCamera({onSample, isActive, onFpsUpdate}: Props): JSX.Element {
  const device = useCameraDevice('back');
  const {hasPermission, requestPermission} = useCameraPermission();
  const enableProcessorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const torchTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // FPS Monitoring
  const frameTimestamps = useRef<number[]>([]);
  const fpsRef = useRef<number>(0);
  
  // Calculate FPS from frame timestamps
  const calculateFPS = useCallback((timestamp: number) => {
    frameTimestamps.current.push(timestamp);
    
    // Keep only last 30 timestamps (1 second at 30fps)
    if (frameTimestamps.current.length > 30) {
      frameTimestamps.current.shift();
    }
    
    // Calculate FPS if we have enough samples
    if (frameTimestamps.current.length >= 10) {
      const timeSpan = frameTimestamps.current[frameTimestamps.current.length - 1] - frameTimestamps.current[0];
      const frameCount = frameTimestamps.current.length - 1;
      const fps = frameCount / timeSpan; // Keep in seconds (VisionCamera timestamps are in seconds)
      
      if (Number.isFinite(fps) && fps > 0) {
        fpsRef.current = fps;
        
        // Notify parent component about FPS update
        if (onFpsUpdate) {
          onFpsUpdate(fps);
        }
        
        // Log FPS periodically
        if (PPG_CONFIG.debug.enabled && frameTimestamps.current.length % 30 === 0) {
          console.log('[PPGCamera] FPS calculated:', {
            fps: fps.toFixed(1),
            frameCount,
            timeSpan: timeSpan.toFixed(3) + 's',
          });
        }
      }
    }
  }, []);

  
  // SAMPLE FLOW DEBUG: Check onSample prop
  useEffect(() => {
    console.log('[PPGCamera] Props received', {
      hasOnSample: typeof onSample === 'function',
      isActive,
    });
  }, [onSample, isActive]);

  // NATIVE MODULES EVENT LISTENER: Listen for samples from PPGCameraManager
  useEffect(() => {
    console.log('[PPGCamera] Setting up NativeModules event listener');
    
    if (!PPGCameraManager) {
      console.warn('[PPGCamera] PPGCameraManager not available');
      return;
    }

    const eventEmitter = new NativeEventEmitter(PPGCameraManager);
           const subscription = eventEmitter.addListener('PPGSample', (event) => {
             console.log('[PPGCamera] Received sample from NativeModules', event);
             
             // FPS Monitoring: Calculate FPS from JS event timestamps (safe from worklet context)
             calculateFPS(event.timestamp);
             
             // NOTE: Camera confidence is always ~0.85, so we don't filter here
             // Poor signal detection is handled by PPGAnalyzer based on metrics/SNR
             
             const sample: PPGSample = {
               value: event.value,
               timestamp: event.timestamp,
               confidence: event.confidence,
             };
             onSample(sample);
           });

    return () => {
      console.log('[PPGCamera] Clearing NativeModules event listener');
      subscription.remove();
    };
  }, [onSample, calculateFPS]);

  useEffect(() => {
    console.log('[PPGCamera] Permission status:', hasPermission);
    if (!hasPermission) {
      console.log('[PPGCamera] Requesting camera permission...');
      requestPermission().catch((error) => {
        console.error('[PPGCamera] Permission request failed:', error);
      });
    }
  }, [hasPermission, requestPermission]);

  const plugin = useMemo<FrameProcessorPlugin | null>(() => {
    try {
      console.log('[PPGCamera] Initializing frame processor plugin');
      const created = VisionCameraProxy.initFrameProcessorPlugin('ppgMean', {}) ?? null;
      console.log('[PPGCamera] Frame processor plugin ready:', !!created);
      return created;
    } catch (error) {
      console.warn('[PPGCamera] frame processor unavailable', error);
      return null;
    }
  }, []);

  const hasTorch = device?.hasTorch === true;
  const [frameProcessorEnabled, setFrameProcessorEnabled] = useState(false);

  // WORKLET CRASH FIX: Disable worklet to prevent crash
  const emitSample = useMemo(
    () => {
      console.log('[PPGCamera] Creating emitSample callback (worklet disabled)', {
        hasOnSample: typeof onSample === 'function',
      });
      return onSample;
    },
    [onSample],
  );

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';
      if (!plugin || typeof plugin.call !== 'function') {
        console.log('[PPGCamera] Frame processor: plugin not ready');
        return;
      }
       // TORCH CRASH FIX: Remove torch parameter to prevent conflicts
       const value = plugin.call(frame, {}) as unknown;
      if (typeof value !== 'number' || Number.isNaN(value)) {
        console.log('[PPGCamera] Frame processor: invalid value', {value, type: typeof value});
        return;
      }
      const timestamp = frame.timestamp ?? Date.now();
      console.log('[PPGCamera] Frame processor: emitting sample', {value, timestamp});
      
      // WORKLET CRASH FIX: FPS monitoring moved to JS event listener
      // No runOnJS calls from frame processor to prevent iOS crashes
      
      // NATIVE NOTIFICATION: PPGMeanPlugin sends NSNotification, PPGCameraManager forwards to JS
      // No worklet callback needed - samples come via NativeModules event
      console.log('[PPGCamera] Frame processor: sample processed by PPGMeanPlugin');
    },
     [onSample, plugin],
  );

  useEffect(() => {
    if (!plugin) {
      setFrameProcessorEnabled(false);
      return;
    }
    if (enableProcessorTimerRef.current) {
      clearTimeout(enableProcessorTimerRef.current);
      enableProcessorTimerRef.current = null;
    }
    if (isActive) {
      enableProcessorTimerRef.current = setTimeout(() => {
        console.log('[PPGCamera] Enabling frame processor');
        setFrameProcessorEnabled(true);
      }, 200);
    } else {
      console.log('[PPGCamera] Disabling frame processor');
      setFrameProcessorEnabled(false);
    }
    return () => {
      if (enableProcessorTimerRef.current) {
        clearTimeout(enableProcessorTimerRef.current);
        enableProcessorTimerRef.current = null;
      }
    };
  }, [isActive, plugin]);

   // FLASH FIX: Use native torch control safely
   useEffect(() => {
     if (Platform.OS !== 'ios' || !hasTorch) {
       return undefined;
     }
     
     const setTorch = async (level: number) => {
       try {
         if (typeof PPGCameraManager?.setTorchLevel === 'function') {
           console.log('[PPGCamera] Native torch request', {level});
           await PPGCameraManager.setTorchLevel(level);
           console.log('[PPGCamera] Native torch applied', {level});
         }
       } catch (error) {
         console.warn('[PPGCamera] Native torch failed', error);
       }
     };

     if (torchTimerRef.current) {
       clearTimeout(torchTimerRef.current);
       torchTimerRef.current = null;
     }

     if (isActive) {
       // FLASH FIX: Delay torch activation to prevent crash
       torchTimerRef.current = setTimeout(() => {
         void setTorch(PPG_CONFIG.camera.torchLevel);
       }, 1000); // Increased delay for safety
     } else {
       void setTorch(0);
     }

     return () => {
       if (torchTimerRef.current) {
         clearTimeout(torchTimerRef.current);
         torchTimerRef.current = null;
       }
       void setTorch(0);
     };
   }, [hasTorch, isActive]);

  useEffect(() => {
    console.log('[PPGCamera] Device/permission check', {
      hasDevice: !!device,
      hasTorch,
      hasPermission,
      isActive,
    });
  }, [device, hasPermission, isActive, hasTorch]);

  useEffect(() => {
    console.log('[PPGCamera] Frame processor status', {
      hasPlugin: !!plugin,
      isActive,
    });
  }, [plugin, isActive]);

   // TORCH CRASH FIX: Disable VisionCamera torch to prevent conflicts
   // FLASH FIX: Use native torch control instead
   const cameraProps: Partial<React.ComponentProps<typeof Camera>> = {
     fps: PPG_CONFIG.camera.fps,
     torch: 'off', // Disable VisionCamera torch
   };

  useEffect(() => {
    console.log('[PPGCamera] Torch mode update', {
      platform: Platform.OS,
      hasTorch,
      isActive,
      torchDelay: isActive ? '1000ms' : 'immediate',
    });
  }, [hasTorch, isActive]);

  if (!device || !hasPermission) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Kamera izni gerekli</Text>
      </View>
    );
  }

  return (
    <Camera
      style={styles.camera}
      device={device}
      isActive={isActive}
      frameProcessor={plugin && frameProcessorEnabled ? frameProcessor : undefined}
      {...cameraProps}
    />
  );
}

const styles = StyleSheet.create({
  camera: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  placeholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#666',
  },
});
