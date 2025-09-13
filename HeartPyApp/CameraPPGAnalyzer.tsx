import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage'; // Optional - not needed for basic functionality
// Haptics is optional; load lazily to avoid crash if native module is missing
let OptionalHaptics: any | null = null;
function getHaptics(): any | null {
  if (OptionalHaptics !== null) return OptionalHaptics;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    OptionalHaptics = require('react-native-haptic-feedback');
  } catch (e) {
    OptionalHaptics = null;
    console.warn('react-native-haptic-feedback not available; skipping haptics');
  }
  return OptionalHaptics;
}
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
// Load HeartPy lazily to avoid Metro resolving issues with local package links
type HeartPyExports = {
  RealtimeAnalyzer: {
    create: (fs: number, options?: any) => Promise<any>;
  };
};
function getHeartPy(): HeartPyExports | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-heartpy');
    return mod as HeartPyExports;
  } catch (e) {
    console.warn('react-native-heartpy not available; streaming disabled', e);
    return null;
  }
}

const { width, height } = Dimensions.get('window');

interface PPGMetrics {
  bpm: number;
  confidence: number;
  snrDb: number;
  rmssd: number;
  sdnn: number;
  pnn50: number;
  lfhf: number;
  breathingRate: number;
  quality: {
    goodQuality: boolean;
    totalBeats: number;
    rejectedBeats: number;
    rejectionRate: number;
    qualityWarning?: string;
  };
}

export default function CameraPPGAnalyzer() {
  const [isActive, setIsActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metrics, setMetrics] = useState<PPGMetrics | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [ppgSignal, setPpgSignal] = useState<number[]>([]);
  const [statusMessage, setStatusMessage] = useState('Kamerayı başlatmak için butona basın');
  const [lastBeatCount, setLastBeatCount] = useState(0);
  const [hapticEnabled, setHapticEnabled] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [useNativePPG, setUseNativePPG] = useState(true);
  const [roi, setRoi] = useState(0.4);

  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });
  const { hasPermission, requestPermission } = useCameraPermission();

  const analyzerRef = useRef<any | null>(null);
  const [targetFps, setTargetFps] = useState(15); // start low for stabilization
  const samplingRate = targetFps; // keep analyzer in sync with camera fps
  const bufferSize = samplingRate * 5; // 5 saniye buffer
  const analysisInterval = 1000; // 1 saniyede bir analiz
  
  const frameBufferRef = useRef<number[]>([]);
  const lastAnalysisTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const torchTimerRef = useRef<any>(null);
  const torchOnTimeRef = useRef<number | null>(null);
  const preTorchFramesRef = useRef<number>(0);
  const smoothBufRef = useRef<number[]>([]);
  const skipWindowRef = useRef<number[]>([]); // 1 = skipped, 0 = accepted
  const brightWindowRef = useRef<number[]>([]); // recent brightness samples
  const [badExposure, setBadExposure] = useState(false);
  const [badExposureReason, setBadExposureReason] = useState<'dark' | 'saturated' | null>(null);

  // (iOS stability) Do NOT initialize plugins on JS thread.
  // Plugins are initialized inside the worklet to avoid invalid handles.

  // Load persisted settings on mount
  // Settings are now handled in-memory only (no AsyncStorage dependency)

  // Haptic feedback configuration
  const hapticOptions = {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  };

  // Trigger haptic feedback for each heartbeat
  const triggerHapticForBeat = useCallback(() => {
    if (!hapticEnabled) return;
    
    try {
      const Haptics = getHaptics();
      if (!Haptics) return;
      // Use different haptic patterns for iOS and Android
      if (Platform.OS === 'ios') {
        Haptics.trigger('impactLight', hapticOptions);
      } else {
        Haptics.trigger('impactMedium', hapticOptions);
      }
    } catch (error) {
      console.warn('Haptic feedback error:', error);
    }
  }, [hapticEnabled]);

  // Stable JS handler for frame processor errors (avoid inline runOnJS closures)
  const onFrameError = useCallback((message: string) => {
    console.warn(message);
  }, []);

  // İzin kontrolü
  useEffect(() => {
    requestCameraPermission();
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          console.log('Android camera permission granted');
        } else {
          Alert.alert('İzin Gerekli', 'Kamera izni gereklidir');
        }
      } catch (err) {
        console.warn('Permission error:', err);
      }
    } else {
      if (!hasPermission) {
        const granted = await requestPermission();
        if (!granted) {
          Alert.alert('İzin Gerekli', 'Kamera izni gereklidir');
        }
      }
    }
  };

  // Frame tick handler: simulate PPG on JS side, keep buffer & trigger analysis
  const onFrameTick = useCallback((timestamp: number) => {
    setFrameCount(prev => prev + 1);

    // Simulate PPG signal (remove once real extractor is stable)
    const nowSec = Date.now() / 1000;
    const hrHz = 1.2; // ~72 BPM
    const sample =
      512 +
      8 * Math.sin(2 * Math.PI * hrHz * nowSec) +
      2 * Math.sin(2 * Math.PI * hrHz * 2 * nowSec) +
      0.5 * Math.sin(2 * Math.PI * 0.25 * nowSec) +
      (Math.random() - 0.5) * 0.5;

    frameBufferRef.current.push(sample);
    if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();

    setPpgSignal(prev => {
      const next = [...prev, sample];
      if (next.length > 100) next.shift();
      return next;
    });

    const now = Date.now();
    if (now - lastAnalysisTimeRef.current > analysisInterval && frameBufferRef.current.length >= samplingRate * 3) {
      lastAnalysisTimeRef.current = now;
      performRealtimeAnalysis();
    }
  }, [analysisInterval]);

  // Real sample handler from native plugin
  const onFrameSample = useCallback((timestamp: number, sample: number) => {
    // Update brightness window
    const bw = brightWindowRef.current;
    bw.push(sample);
    if (bw.length > 30) bw.shift(); // last ~2s at 15 FPS

    // Determine skip decision
    let skip = false;
    if (!Number.isFinite(sample)) skip = true;
    if (sample < 15 || sample > 240) skip = true; // too dark/bright

    // Outlier guard vs recent smoothed history
    const recent = smoothBufRef.current;
    if (!skip && recent.length >= 3) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const varc = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
      const std = Math.sqrt(varc);
      if (std > 0 && Math.abs(sample - mean) > 3 * std) skip = true;
    }

    // Update skip window (1 skipped, 0 accepted)
    const sw = skipWindowRef.current;
    sw.push(skip ? 1 : 0);
    if (sw.length > 30) sw.shift();

    if (skip) return;

    // iOS-only torch gating: enable torch after a few stable frames
    if (Platform.OS === 'ios' && isActive && !torchOn && useNativePPG) {
      preTorchFramesRef.current += 1;
      if (preTorchFramesRef.current >= 3) {
        setTorchOn(true);
        try { torchOnTimeRef.current = Date.now(); } catch {}
      }
    }

    // Smoothing: simple moving average over last N values (including this one)
    const N = 5; // ~150–250 ms at 15–30 FPS
    const nextRecent = [...recent, sample];
    if (nextRecent.length > N) nextRecent.shift();
    smoothBufRef.current = nextRecent;
    const smoothed = nextRecent.reduce((a, b) => a + b, 0) / nextRecent.length;

    setFrameCount(prev => prev + 1);
    frameBufferRef.current.push(smoothed);
    if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();
    setPpgSignal(prev => {
      const next = [...prev, smoothed];
      if (next.length > 100) next.shift();
      return next;
    });
    const now = Date.now();
    // Delay analysis start for 500ms after torch turns on (exposure settle)
    if (useNativePPG) {
      if (!torchOnTimeRef.current || now - torchOnTimeRef.current < 500) return;
    }
    if (now - lastAnalysisTimeRef.current > analysisInterval && frameBufferRef.current.length >= samplingRate * 3) {
      lastAnalysisTimeRef.current = now;
      performRealtimeAnalysis();
    }
  }, [analysisInterval, samplingRate, useNativePPG]);

  // Frame işleme
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    try {
      const ts = (frame as any)?.timestamp ?? 0;
      if (useNativePPG) {
        // Initialize plugin inside worklet (once), then call per frame
        // @ts-ignore
        if (!(globalThis as any).__ppg) {
          // @ts-ignore
          (globalThis as any).__ppg = VisionCameraProxy.initFrameProcessorPlugin('ppgMean', {});
        }
        // @ts-ignore
        const plugin = (globalThis as any).__ppg;
        if (plugin != null) {
          const v = plugin.call(frame, { roi, channel: 'red', step: 2 }) as number;
          runOnJS(onFrameSample)(ts, v);
        } else {
          runOnJS(onFrameError)('ppgMean plugin not available');
        }
      } else {
        // Notify JS to simulate/handle buffering
        runOnJS(onFrameTick)(ts);
      }
    } catch (error) {
      // Only pass simple data across the bridge
      // Avoid sending full error objects from worklet → JS
      const msg = `Frame processor error: ${error}`;
      runOnJS(onFrameError)(msg);
    }
  }, [onFrameTick, onFrameSample, useNativePPG, roi]);

  // Derive bad exposure badge at 2 Hz
  useEffect(() => {
    const id = setInterval(() => {
      const sw = skipWindowRef.current;
      const bw = brightWindowRef.current;
      const n = sw.length;
      if (n === 0) {
        setBadExposure(false);
        setBadExposureReason(null);
        return;
      }
      const skipRate = sw.reduce((a, b) => a + b, 0) / n;
      // Check last 5 brightness samples for saturation/darkness trend
      const lastK = bw.slice(-5);
      let darkCount = 0;
      let satCount = 0;
      for (const v of lastK) {
        if (!Number.isFinite(v)) continue;
        if (v < 15) darkCount++;
        if (v > 240) satCount++;
      }
      const flag = skipRate > 0.3 || darkCount >= 5 || satCount >= 5;
      setBadExposure(flag);
      if (!flag) {
        setBadExposureReason(null);
      } else {
        if (satCount >= darkCount && satCount >= 3) setBadExposureReason('saturated');
        else if (darkCount >= 3) setBadExposureReason('dark');
        else setBadExposureReason(null);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Real-time analiz
  const performRealtimeAnalysis = async () => {
    if (!analyzerRef.current || frameBufferRef.current.length < 60) return;

    try {
      // Son n sample'ı al (3 saniye)
      const samplesNeeded = samplingRate * 3;
      const samples = frameBufferRef.current.slice(-samplesNeeded);
      const samplesArray = new Float32Array(samples);
      
      // Streaming analyzer'a gönder
      await analyzerRef.current.push(samplesArray);
      
      // Metrikleri al
      const result = await analyzerRef.current.poll();
      
      if (result) {
        const newMetrics: PPGMetrics = {
          bpm: result.bpm,
          confidence: (result as any).quality?.confidence ?? 0,
          snrDb: (result as any).quality?.snrDb ?? 0,
          rmssd: result.rmssd,
          sdnn: result.sdnn,
          pnn50: result.pnn50,
          lfhf: result.lfhf,
          breathingRate: result.breathingRate,
          quality: result.quality,
        };
        
        setMetrics(newMetrics);
        
        // Check for new beats and trigger haptic feedback
        const currentBeatCount = newMetrics.quality.totalBeats;
        if (currentBeatCount > lastBeatCount && lastBeatCount > 0) {
          // New beat detected! Trigger haptic feedback
          const newBeats = currentBeatCount - lastBeatCount;
          console.log(`💓 ${newBeats} new beat(s) detected! Total: ${currentBeatCount}`);
          
          // Trigger haptic for each new beat (but limit to reasonable amount)
          for (let i = 0; i < Math.min(newBeats, 3); i++) {
            setTimeout(() => triggerHapticForBeat(), i * 100); // Stagger multiple beats
          }
        }
        setLastBeatCount(currentBeatCount);
        
        // Status mesajını güncelle
        if (newMetrics.quality.goodQuality) {
          setStatusMessage(`✅ Kaliteli sinyal - BPM: ${newMetrics.bpm.toFixed(0)} 💓 ${currentBeatCount} beat`);
        } else {
          setStatusMessage(`⚠️ Zayıf sinyal - ${newMetrics.quality.qualityWarning || 'Parmağınızı kameraya daha iyi yerleştirin'}`);
        }
      }
    } catch (error) {
      console.warn('Analysis error:', error);
      setStatusMessage('❌ Analiz hatası');
    }
  };

  // Analizi başlat/durdur
  const toggleAnalysis = async () => {
    if (isAnalyzing) {
      // Durdur
      setIsAnalyzing(false);
      setIsActive(false);
      setTorchOn(false);
      preTorchFramesRef.current = 0;
      if (analyzerRef.current) {
        await analyzerRef.current.destroy();
        analyzerRef.current = null;
      }
      if (torchTimerRef.current) {
        clearTimeout(torchTimerRef.current);
        torchTimerRef.current = null;
      }
      frameBufferRef.current = [];
      setMetrics(null);
      setPpgSignal([]);
      setLastBeatCount(0);
      setFrameCount(0);
      setStatusMessage('Analiz durduruldu');
    } else {
      // Başlat
      try {
        setIsAnalyzing(true);
        setStatusMessage('Analiz başlatılıyor...');
        startTimeRef.current = Date.now();
        setLastBeatCount(0);
        setFrameCount(0);
        setPpgSignal([]);
        setTorchOn(false);
        
        // RealtimeAnalyzer oluştur
        console.log('Getting HeartPy module...');
        const HP = getHeartPy();
        console.log('HeartPy module:', !!HP);
        if (!HP) throw new Error('HeartPy JS wrapper not available');
        
        console.log('RealtimeAnalyzer available:', !!HP.RealtimeAnalyzer);
        console.log('create function available:', !!HP.RealtimeAnalyzer?.create);
        
        console.log('Creating analyzer with samplingRate:', samplingRate);
        
        // Test simple creation first
        console.log('Testing simple analyzer creation...');
        analyzerRef.current = await HP.RealtimeAnalyzer.create(samplingRate, {
          bandpass: { lowHz: 0.5, highHz: 4.0, order: 2 },
          welch: { nfft: 512, overlap: 0.5 },
          peak: { 
            refractoryMs: 300, 
            thresholdScale: 0.6, 
            bpmMin: 50, 
            bpmMax: 150 
          },
          quality: {
            cleanRR: true,
            cleanMethod: 'quotient-filter',
          },
        });
        console.log('Analyzer created successfully:', !!analyzerRef.current);
        
        console.log('HeartPy module test completed successfully!');
        
        // Kamerayı aktif et
        console.log('Setting camera active...');
        setIsActive(true);
        console.log('Camera activated, setting status message...');
        setStatusMessage('📱 Parmağınızı kameranın flaş ışığına hafifçe yerleştirin');

        console.log(`PPG Analysis started with ${targetFps} FPS sampling via frameProcessor`);
      } catch (error) {
        console.error('Start analysis error:', error);
        try { console.error('Error type:', typeof error); } catch {}
        // Avoid accessing non-standard properties on unknown error
        try { console.error('Error string:', String(error)); } catch {}
        setIsAnalyzing(false);
        setIsActive(false); // Kamerayı da kapat
        setStatusMessage('❌ Başlatma hatası');
        // Avoid UI blocking alert during start
      }
    }
  };

  // Component unmount temizleme
  useEffect(() => {
    return () => {
      if (analyzerRef.current) {
        analyzerRef.current.destroy();
      }
      if (torchTimerRef.current) {
        clearTimeout(torchTimerRef.current);
        torchTimerRef.current = null;
      }
    };
  }, []);

  // Debug info
  useEffect(() => {
    console.log('Camera permission status:', hasPermission);
    console.log('Camera device available:', !!device);
  }, [hasPermission, device]);
  
  if (!hasPermission) {
    console.log('Camera permission denied, showing permission screen');
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Kamera izni gerekiyor</Text>
        <TouchableOpacity style={styles.button} onPress={requestCameraPermission}>
          <Text style={styles.buttonText}>İzin Ver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Kamera bulunamadı</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📱 Kamera PPG - Kalp Atışı Ölçümü</Text>
      
      {/* Kamera Görünümü */}
      <View style={styles.cameraContainer}>
        {/* Spread fps prop conditionally to avoid iOS format reconfig issues */}
        <Camera
          style={styles.camera}
          device={device}
          isActive={isActive}
          frameProcessor={isActive ? frameProcessor : undefined}
          {...(Platform.OS === 'android' ? { fps: targetFps } : {})}
          torch={device?.hasTorch && torchOn ? 'on' : 'off'} // Torch enabled after init delay
          onError={(error) => {
            console.error('Camera error:', error);
            console.error('Camera error code:', error.code);
            console.error('Camera error message:', error.message);
            // Avoid blocking alerts during camera runtime
            setIsActive(false);
            setIsAnalyzing(false);
            setStatusMessage('❌ Kamera hatası: ' + error.message);
          }}
          onInitialized={() => {
        // Delay torch enable (Android only). On iOS, gate by processed frames in onFrameSample.
        if (Platform.OS === 'android') {
          if (torchTimerRef.current) clearTimeout(torchTimerRef.current);
          torchTimerRef.current = setTimeout(() => {
            if (isActive) setTorchOn(true);
            try { torchOnTimeRef.current = Date.now(); } catch {}
          }, 300);
        }
          }}
        />
        {isActive && badExposure && (
          <View style={styles.badBadge}>
            <Text style={styles.badBadgeText}>
              {badExposureReason === 'dark' ? 'Too dark' : badExposureReason === 'saturated' ? 'Saturated' : 'Bad exposure'}
            </Text>
          </View>
        )}
        {!isActive && (
          <View style={styles.cameraOverlay}>
            <Text style={styles.overlayText}>Kamera Hazır</Text>
          </View>
        )}
      </View>

      {/* Durum ve Kontroller */}
      <Text style={styles.status}>{statusMessage}</Text>
      
      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.mainButton, isAnalyzing ? styles.stopButton : styles.startButton]} 
          onPress={toggleAnalysis}
          disabled={!device}
        >
          <Text style={styles.buttonText}>
            {isAnalyzing ? (
              <>
                <ActivityIndicator size="small" color="white" /> Dur
              </>
            ) : (
              '▶️ Başlat'
            )}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.button, styles.hapticButton, hapticEnabled ? styles.hapticEnabled : styles.hapticDisabled]} 
          onPress={() => { 
            setHapticEnabled(!hapticEnabled); 
          }}
        >
          <Text style={styles.hapticButtonText}>
            {hapticEnabled ? '📳 Haptic ON' : '📵 Haptic OFF'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.hapticButton]}
          onPress={() => {
            setTargetFps(targetFps === 15 ? 30 : 15);
          }}
          disabled={isAnalyzing}
        >
          <Text style={styles.hapticButtonText}>
            {`FPS ${targetFps} (tap to ${targetFps === 15 ? 30 : 15})`}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.hapticButton, useNativePPG ? styles.hapticEnabled : styles.hapticDisabled]}
          onPress={() => {
            setUseNativePPG(!useNativePPG);
          }}
          disabled={isAnalyzing}
        >
          <Text style={styles.hapticButtonText}>
            {useNativePPG ? 'PPG: Native ROI' : 'PPG: Simulated'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.hapticButton]}
          onPress={async () => {
            const steps = [0.2, 0.3, 0.4, 0.5, 0.6];
            const idx = steps.indexOf(Number(roi.toFixed(1)));
            const next = steps[(idx + 1) % steps.length];
            setRoi(next);
            // ROI setting saved in memory only
          }}
          disabled={isAnalyzing || !useNativePPG}
        >
          <Text style={styles.hapticButtonText}>
            {`ROI ${roi.toFixed(1)}`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* PPG Sinyali Gösterimi */}
      {ppgSignal.length > 0 && (
        <View style={styles.signalContainer}>
          <Text style={styles.signalTitle}>PPG Sinyali (son {ppgSignal.length} sample)</Text>
          <Text style={styles.signalText}>
            Frame: {frameCount} | Buffer: {frameBufferRef.current.length}
          </Text>
        </View>
      )}

      {/* Real-time Metrikler */}
      {metrics && (
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsTitle}>📊 Real-time Metrikler</Text>
          
          <View style={styles.metricsGrid}>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{metrics.bpm.toFixed(0)}</Text>
              <Text style={styles.metricLabel}>BPM</Text>
            </View>
            
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{(metrics.confidence * 100).toFixed(0)}%</Text>
              <Text style={styles.metricLabel}>Güven</Text>
            </View>
            
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{metrics.snrDb.toFixed(1)}</Text>
              <Text style={styles.metricLabel}>SNR dB</Text>
            </View>
          </View>

          <View style={styles.detailedMetrics}>
            <Text style={styles.detailText}>RMSSD: {metrics.rmssd.toFixed(1)} ms</Text>
            <Text style={styles.detailText}>SDNN: {metrics.sdnn.toFixed(1)} ms</Text>
            <Text style={styles.detailText}>pNN50: {(metrics.pnn50 * 100).toFixed(1)}%</Text>
            <Text style={styles.detailText}>LF/HF: {metrics.lfhf.toFixed(2)}</Text>
            <Text style={styles.detailText}>Nefes: {metrics.breathingRate.toFixed(2)} Hz</Text>
            <Text style={styles.detailText}>
              Kalite: {metrics.quality.totalBeats} atış, 
              {metrics.quality.rejectedBeats} reddedilen 
              ({(metrics.quality.rejectionRate * 100).toFixed(0)}%)
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: '#333',
  },
  cameraContainer: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  status: {
    textAlign: 'center',
    fontSize: 16,
    marginBottom: 16,
    color: '#666',
    minHeight: 40,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  mainButton: {
    flex: 2,
  },
  hapticButton: {
    flex: 1,
    paddingVertical: 12,
  },
  startButton: {
    backgroundColor: '#4CAF50',
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  hapticEnabled: {
    backgroundColor: '#2196F3',
  },
  hapticDisabled: {
    backgroundColor: '#757575',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  hapticButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  permissionText: {
    textAlign: 'center',
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  signalContainer: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  signalTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  signalText: {
    fontSize: 12,
    color: '#666',
  },
  metricsContainer: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  metricsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  metricBox: {
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    minWidth: 80,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  metricLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  detailedMetrics: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
  },
  detailText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  badBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FB8C00',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
