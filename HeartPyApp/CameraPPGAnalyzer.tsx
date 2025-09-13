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
  DeviceEventEmitter,
  NativeEventEmitter,
  NativeModules,
  ScrollView,
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage'; // Optional - not needed for basic functionality
// Haptics is optional; load lazily to avoid crash if native module is missing
let OptionalHaptics: any | null = null;
function getHaptics(): any | null {
  if (OptionalHaptics !== null) return OptionalHaptics;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-haptic-feedback');
    OptionalHaptics = mod && (mod.default ? mod.default : mod);
  } catch (e) {
    OptionalHaptics = null;
    console.warn('react-native-haptic-feedback not available; skipping haptics');
  }
  return OptionalHaptics;
}
// Optional persistent storage (AsyncStorage) - fallback to no-op if missing
let OptionalStorage: any | null = null;
function getStorage(): any | null {
  if (OptionalStorage !== null) return OptionalStorage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    OptionalStorage = mod?.default ?? mod;
  } catch (e) {
    OptionalStorage = null;
    console.warn('AsyncStorage not available; settings will not persist');
  }
  return OptionalStorage;
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
  sdsd: number;
  pnn50: number;
  pnn20?: number;
  nn20?: number;
  nn50?: number;
  mad?: number;
  lfhf: number;
  vlf?: number;
  lf?: number;
  hf?: number;
  totalPower?: number;
  lfNorm?: number;
  hfNorm?: number;
  breathingRate: number;
  sd1?: number;
  sd2?: number;
  sd1sd2Ratio?: number;
  ellipseArea?: number;
  f0Hz?: number;
  quality: {
    goodQuality: boolean;
    totalBeats: number;
    rejectedBeats: number;
    rejectionRate: number;
    qualityWarning?: string;
    doublingFlag?: boolean;
    softDoublingFlag?: boolean;
    doublingHintFlag?: boolean;
    hardFallbackActive?: boolean;
    rrFallbackModeActive?: boolean;
    refractoryMsActive?: number;
    minRRBoundMs?: number;
    pairFrac?: number;
    rrShortFrac?: number;
    rrLongMs?: number;
    pHalfOverFund?: number;
  };
}

export default function CameraPPGAnalyzer() {
  const [isActive, setIsActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [metrics, setMetrics] = useState<PPGMetrics | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [ppgSignal, setPpgSignal] = useState<number[]>([]);
  const [rawResult, setRawResult] = useState<any | null>(null);
  const [statusMessage, setStatusMessage] = useState('Kamerayı başlatmak için butona basın');
  const [lastBeatCount, setLastBeatCount] = useState(0);
  const [hapticEnabled, setHapticEnabled] = useState(true); // Fixed ON
  const [torchOn, setTorchOn] = useState(false); // Auto-controlled
  const [useNativePPG, setUseNativePPG] = useState(true); // Fixed ON - ONLY REAL PPG DATA
  const [roi, setRoi] = useState(0.4); // Fixed optimal
  const [ppgChannel, setPpgChannel] = useState<'green' | 'red' | 'luma'>('red'); // Fixed optimal for PPG
  const [ppgMode, setPpgMode] = useState<'mean' | 'chrom' | 'pos'>('mean'); // Fixed optimal
  const [ppgGrid, setPpgGrid] = useState<1 | 2 | 3>(1); // Fixed optimal
  const [pluginConfidence, setPluginConfidence] = useState<number>(0);
  const [autoSelect, setAutoSelect] = useState(true); // Fixed ON
  // Removed UI control states

  // Load/save persistent settings (best-effort)
  useEffect(() => {
    (async () => {
      const S = getStorage();
      if (!S?.getItem) return;
      try {
        const raw = await S.getItem('hp_ppg_settings');
        if (!raw) return;
        const cfg = JSON.parse(raw);
        if (typeof cfg.autoSelect === 'boolean') setAutoSelect(cfg.autoSelect);
        if (cfg.ppgChannel && ['green','red','luma'].includes(cfg.ppgChannel)) setPpgChannel(cfg.ppgChannel);
        if (cfg.ppgMode && ['mean','chrom','pos'].includes(cfg.ppgMode)) setPpgMode(cfg.ppgMode);
        if (cfg.ppgGrid && [1,2,3].includes(cfg.ppgGrid)) setPpgGrid(cfg.ppgGrid);
        if (typeof cfg.roi === 'number') setRoi(Math.max(0.2, Math.min(0.6, cfg.roi)));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const S = getStorage();
      if (!S?.setItem) return;
      try {
        const cfg = { autoSelect, ppgChannel, ppgMode, ppgGrid, roi };
        await S.setItem('hp_ppg_settings', JSON.stringify(cfg));
      } catch {}
    })();
  }, [autoSelect, ppgChannel, ppgMode, ppgGrid, roi]);
  
  // Derived: blended final confidence (0..1)
  const finalConfidence = (() => {
    const m = metrics?.confidence ?? 0;
    const p = pluginConfidence ?? 0;
    return Math.max(0, Math.min(1, 0.5 * m + 0.5 * p));
  })();
  const confColor = finalConfidence >= 0.7 ? '#4CAF50' : finalConfidence >= 0.4 ? '#FB8C00' : '#f44336';

  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });
  const { hasPermission, requestPermission } = useCameraPermission();

  // Debug camera state (logs only; avoid alerts on UI)
  useEffect(() => {
    try {
      console.log('🔍 Camera Debug Info:', {
        hasPermission,
        deviceAvailable: !!device,
        deviceId: device?.id,
        deviceName: device?.name,
      });
    } catch {}
  }, [hasPermission, device]);

  const analyzerRef = useRef<any | null>(null);
  const [targetFps, setTargetFps] = useState(30); // Optimal FPS for PPG
  const [analyzerFs, setAnalyzerFs] = useState(30); // matched to targetFps
  const samplingRate = analyzerFs; // keep analyzer in sync with actual fps
  const bufferSize = samplingRate * 5; // 5 saniye buffer
  const analysisInterval = 1000; // 1 saniyede bir analiz
  
  const frameBufferRef = useRef<number[]>([]);
  const lastAnalysisTimeRef = useRef<number>(0);
  const pendingSamplesRef = useRef<number[]>([]); // incremental push queue
  const startTimeRef = useRef<number>(0);
  const torchTimerRef = useRef<any>(null);
  const simulationTimerRef = useRef<any>(null);
  const torchOnTimeRef = useRef<number | null>(null);
  const preTorchFramesRef = useRef<number>(0);
  const warnedJSIFallbackRef = useRef(false);

  // VisionCamera frame processor plugin initialized on JS thread
  const ppgPluginRef = useRef<any>(null);
  const [ppgPlugin, setPpgPlugin] = useState<any>(null);
  useEffect(() => {
    if (useNativePPG) {
      try {
        console.log('🟢 Initializing ppgMean plugin on JS thread...');
        const plugin = VisionCameraProxy.initFrameProcessorPlugin('ppgMean', {});
        ppgPluginRef.current = plugin;
        setPpgPlugin(plugin);
        console.log('🟢 ppgMean plugin initialized successfully:', !!plugin);
      } catch (e) {
        console.error('🔴 ppgMean plugin init failed:', e);
        ppgPluginRef.current = null;
        setPpgPlugin(null);
      }
    } else {
      ppgPluginRef.current = null;
      setPpgPlugin(null);
    }
  }, [useNativePPG]);

  // Load persisted settings on mount
  // Settings are now handled in-memory only (no AsyncStorage dependency)

  // Haptic feedback configuration
  const hapticOptions = {
    enableVibrateFallback: true,
    // Force haptic even if system toggle is off (Android)
    ignoreAndroidSystemSettings: true,
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

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA
        );
        const ok = granted === PermissionsAndroid.RESULTS.GRANTED;
        if (ok) console.log('Android camera permission granted');
        else Alert.alert('İzin Gerekli', 'Kamera izni gereklidir');
        return ok;
      } catch (err) {
        console.warn('Permission error:', err);
        return false;
      }
    } else {
      if (!hasPermission) {
        const granted = await requestPermission();
        if (!granted) Alert.alert('İzin Gerekli', 'Kamera izni gereklidir');
        return !!granted;
      }
      return true;
    }
  };

  // (removed) onFrameTick path was unused

  // (removed) onFrameSample path; we rely on native buffer polling

  // Global communication - worklet ↔ main thread
  const globalFrameCounter = useRef(0);
  
  // Native module polling for real PPG data - practical UI solution
  useEffect(() => {
    if (!isActive || !useNativePPG) return;
    
    const pollingInterval = setInterval(async () => {
      try {
        // Direct native module call for PPG buffer
        const samples = await NativeModules.HeartPyModule?.getLatestPPGSamples?.();
        
        if (samples && Array.isArray(samples) && samples.length > 0) {
          // Update UI with real PPG data
          const latestSamples = samples.slice(-10); // Last 10 samples
          
          latestSamples.forEach(sample => {
            const val = typeof sample === 'number' ? sample : parseFloat(sample);
            if (isFinite(val)) {
              frameBufferRef.current.push(val);
              if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();
              // Queue for incremental streaming
              pendingSamplesRef.current.push(val);
              if (pendingSamplesRef.current.length > bufferSize) {
                pendingSamplesRef.current.splice(0, pendingSamplesRef.current.length - bufferSize);
              }
            }
          });
          
          setPpgSignal(prev => {
            const validSamples = latestSamples.filter(s => isFinite(parseFloat(s)));
            const next = [...prev, ...validSamples.map(s => parseFloat(s))];
            if (next.length > 100) return next.slice(-100);
            return next;
          });
          
          // Periodic log only
          if ((globalFrameCounter.current || 0) % 120 === 0) {
            console.log(`PPG poll: +${latestSamples.length}, frameBuf=${frameBufferRef.current.length}`);
          }
        } else {
          // Quiet when empty
        }
      } catch (pollError) {
        if ((globalFrameCounter.current || 0) % 240 === 0) console.error('PPG polling error:', pollError);
      }
    }, 300); // ~3 Hz polling for UI responsiveness
    
    return () => clearInterval(pollingInterval);
  }, [isActive, useNativePPG, bufferSize]);

  // Frame işleme - minimal logs
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    try {
      globalFrameCounter.current = (globalFrameCounter.current || 0) + 1;
      
      if (useNativePPG) {
        // Gerçek PPG plugin - minimal runOnJS transfer
        const plugin = ppgPlugin;
        
        if (plugin != null && frame != null) {
          try {
            const v = plugin.call(frame, { roi, channel: ppgChannel, step: 2, mode: ppgMode, grid: ppgGrid, blend: autoSelect ? 'auto' : 'off', torch: !!torchOn }) as number;
            // Native data flow handled in-platform; no per-frame logs
          } catch (pluginError) {
            if (globalFrameCounter.current % 240 === 0) {
              console.log('PPG plugin error:', pluginError);
            }
          }
        }
      }
      
      // Frame count log (minimal)
      if (globalFrameCounter.current % 120 === 0) {
        console.log(`PPG Frames: ${globalFrameCounter.current} processed`);
      }
    } catch (e) {
      if ((globalFrameCounter.current || 0) % 240 === 0) {
        console.log('Frame processor error:', e);
      }
    }
  }, [useNativePPG, roi, ppgPlugin, ppgChannel, ppgMode, ppgGrid, autoSelect, torchOn]);

  // Native module polling for real PPG data + timestamps + plugin confidence
  useEffect(() => {
    if (!isActive || !useNativePPG) return;
    const pollingInterval = setInterval(async () => {
      try {
        const [pack, conf] = await Promise.all([
          NativeModules.HeartPyModule?.getLatestPPGSamplesTs?.() ?? NativeModules.HeartPyModule?.getLatestPPGSamples?.(),
          NativeModules.HeartPyModule?.getLastPPGConfidence?.(),
        ]);
        if (typeof conf === 'number' && isFinite(conf)) setPluginConfidence(conf);
        let latestSamples: number[] = [];
        let latestTs: number[] | null = null;
        if (pack && Array.isArray(pack)) {
          latestSamples = (pack as any[]).slice(-10).map(s => (typeof s === 'number' ? s : parseFloat(s))).filter((v: any) => isFinite(v));
        } else if (pack && typeof pack === 'object') {
          const xs = Array.isArray(pack.samples) ? pack.samples : [];
          const ts = Array.isArray(pack.timestamps) ? pack.timestamps : [];
          const k = Math.min(xs.length, ts.length);
          latestSamples = xs.slice(-10).map((s: any) => (typeof s === 'number' ? s : parseFloat(s))).filter((v: any) => isFinite(v));
          latestTs = ts.slice(-10).map((t: any) => (typeof t === 'number' ? t : parseFloat(t))).filter((v: any) => isFinite(v));
        }
        if (latestSamples.length > 0) {
          // Update UI and incremental queue
          latestSamples.forEach((val, i) => {
            frameBufferRef.current.push(val);
            if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();
            pendingSamplesRef.current.push(val);
            if (pendingSamplesRef.current.length > bufferSize) pendingSamplesRef.current.splice(0, pendingSamplesRef.current.length - bufferSize);
          });
          setPpgSignal(prev => {
            const next = [...prev, ...latestSamples];
            if (next.length > 100) return next.slice(-100);
            return next;
          });
          // If timestamps available and analyzer supports, push with timestamps now (optional)
          try {
            if (latestTs && latestTs.length === latestSamples.length && analyzerRef.current?.pushWithTimestamps) {
              const xs = new Float32Array(latestSamples);
              const ts = new Float64Array(latestTs);
              await analyzerRef.current.pushWithTimestamps(xs, ts);
              pendingSamplesRef.current = [];
            }
          } catch {}
        }
      } catch (e) {
        // occasional polling errors are non-fatal
      }
    }, 300);
    return () => clearInterval(pollingInterval);
  }, [isActive, useNativePPG, bufferSize]);

  // Timer ile global frame counter'ı UI'ye yansıt
  useEffect(() => {
    if (!isActive) return;
    
    const uiUpdateTimer = setInterval(() => {
      const count = globalFrameCounter.current || 0;
      setFrameCount(count);

      // Periodic lightweight log
      if (count % 120 === 0) {
        console.log(`UI Timer: frameBuffer=${frameBufferRef.current.length}`);
      }

      const now = Date.now();
      if (now - lastAnalysisTimeRef.current > analysisInterval && frameBufferRef.current.length >= samplingRate * 3) {
        lastAnalysisTimeRef.current = now;
        performRealtimeAnalysis();
      }
    }, 1000 / 15); // 15 FPS UI update
    
    return () => clearInterval(uiUpdateTimer);
  }, [isActive, analysisInterval, samplingRate, bufferSize, useNativePPG]);

  // (removed) exposure badge derivation; consider dynamic gate later

  // Real-time analiz - incremental streaming push + metric poll
  const performRealtimeAnalysis = async () => {
    if (!analyzerRef.current) return;

    try {
      // Push only new samples accumulated since last call
      const pending = pendingSamplesRef.current;
      if (pending.length > 0) {
        const samplesArray = new Float32Array(pending);
        // Validate samples array
        if (!samplesArray.every(s => typeof s === 'number' && isFinite(s))) {
          console.warn('Invalid samples in pending queue');
        } else {
          try {
            await analyzerRef.current.push(samplesArray);
          } catch (pushError) {
            console.error('Native analyzer push failed:', pushError);
            setStatusMessage('❌ Native analyzer push hatası');
            return;
          }
        }
        // Clear pending after push
        pendingSamplesRef.current = [];
      }
      
      // Metrikleri al - defensive native call
      let result;
      try {
        result = await analyzerRef.current.poll();
      } catch (pollError) {
        console.error('Native analyzer poll failed:', pollError);
        setStatusMessage('❌ Native analyzer poll hatası');
        return;
      }
      
      if (result && typeof result === 'object') {
        try { setRawResult(result as any); } catch {}
        try {
          const newMetrics: PPGMetrics = {
            bpm: typeof result.bpm === 'number' ? result.bpm : 0,
            confidence: (result as any).quality?.confidence ?? 0,
            snrDb: (result as any).quality?.snrDb ?? 0,
            rmssd: typeof result.rmssd === 'number' ? result.rmssd : 0,
            sdnn: typeof result.sdnn === 'number' ? result.sdnn : 0,
            sdsd: typeof result.sdsd === 'number' ? result.sdsd : 0,
            pnn50: typeof result.pnn50 === 'number' ? result.pnn50 : 0,
            lfhf: typeof result.lfhf === 'number' ? result.lfhf : 0,
            breathingRate: typeof result.breathingRate === 'number' ? result.breathingRate : 0,
            quality: result.quality || { goodQuality: false, totalBeats: 0, rejectedBeats: 0, rejectionRate: 0 },
          };
          
          setMetrics(newMetrics);
          
        // Check for new beats and trigger haptic feedback
        const currentBeatCount = newMetrics.quality.totalBeats;
        if (currentBeatCount > lastBeatCount) {
          // New beat detected! Trigger haptic feedback
          const newBeats = currentBeatCount - lastBeatCount;
          console.log(`💓 ${newBeats} new beat(s) detected! Total: ${currentBeatCount}`);
          
          // Immediate haptic trigger for new beats
          if (hapticEnabled) {
            try {
              const Haptics = getHaptics();
              if (Haptics) {
                Haptics.trigger('impactMedium', hapticOptions);
                console.log(`📳 Haptic triggered for beat ${currentBeatCount}`);
              } else {
                console.log('📳 Haptic module not available');
              }
            } catch (e) {
              console.error('Haptic error:', e);
            }
          }
        }
        setLastBeatCount(currentBeatCount);
          
          // Status mesajını güncelle
          if (newMetrics.quality.goodQuality) {
            setStatusMessage(`✅ Kaliteli sinyal - BPM: ${newMetrics.bpm?.toFixed?.(0) ?? '—'} 💓 ${String(currentBeatCount)} beat`);
          } else {
            setStatusMessage(`⚠️ Zayıf sinyal - ${newMetrics.quality.qualityWarning || 'Parmağınızı kameraya daha iyi yerleştirin'}`);
          }
        } catch (metricsError) {
          console.error('Metrics processing error:', metricsError);
          console.error('Error stack:', metricsError.stack);
          console.error('Result object that caused error:', JSON.stringify(result, null, 2));
          setStatusMessage('❌ Metrik işleme hatası');
        }
      }
    } catch (error) {
      console.error('Analysis error:', error);
      setStatusMessage('❌ Analiz hatası - detay: ' + String(error));
    }
  };

  const pendingActivateRef = useRef(false);

  // Analizi başlat/durdur
  const toggleAnalysis = async () => {
    console.log('🔵 toggleAnalysis called, isAnalyzing:', isAnalyzing);
    if (isAnalyzing) {
      // Durdur
      setIsAnalyzing(false);
      setIsActive(false);
      setTorchOn(false);
      preTorchFramesRef.current = 0;
      if (analyzerRef.current) {
        try {
          await analyzerRef.current.destroy();
        } catch (destroyError) {
          console.error('Native analyzer destroy failed:', destroyError);
        }
        analyzerRef.current = null;
      }
      if (torchTimerRef.current) {
        clearTimeout(torchTimerRef.current);
        torchTimerRef.current = null;
      }
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
      frameBufferRef.current = [];
      pendingSamplesRef.current = [];
      globalFrameCounter.current = 0;
      setMetrics(null);
      setPpgSignal([]);
      setLastBeatCount(0);
      setFrameCount(0);
      setStatusMessage('Analiz durduruldu');
    } else {
      // Başlat
      console.log('🟢 Starting analysis...');
      try {
        console.log('🟢 Setting isAnalyzing to true');
        setIsAnalyzing(true);
        setStatusMessage('Analiz başlatılıyor...');
        startTimeRef.current = Date.now();
        setLastBeatCount(0);
        setFrameCount(0);
        setPpgSignal([]);
        setTorchOn(false);

        // Ensure permission first
        if (!hasPermission) {
          console.log('Requesting camera permission before activation...');
          const ok = await requestCameraPermission();
          if (!ok) {
            setIsAnalyzing(false);
            setStatusMessage('Kamera izni gerekiyor');
            return;
          }
        }
        
        // Camera activation & FS calibration before analyzer create
        let fsForAnalyzer = analyzerFs;
        if (device) {
          console.log('🟢 Activating camera for FS calibration...');
          setIsActive(true);
          setStatusMessage('Kalibrasyon: FPS ölçülüyor...');
          // Small delay for camera warm-up
          await new Promise(res => setTimeout(res, 300));
          // Try to enable torch quickly for finger PPG
          if (device?.hasTorch) setTorchOn(true);
          // Fixed optimal FPS - no calibration needed
          const fsForAnalyzer = targetFps; // Use fixed 30 FPS
          console.log(`📏 Using fixed optimal FPS: ${fsForAnalyzer}`);
        } else {
          console.log('⏳ Device not ready; skipping FS calibration, using analyzerFs');
          pendingActivateRef.current = true;
          setStatusMessage('Kamera hazırlanıyor...');
        }

        // RealtimeAnalyzer oluştur
        console.log('🟢 Getting HeartPy module...');
        const HP = getHeartPy();
        console.log('🟢 HeartPy module available:', !!HP);
        if (!HP?.RealtimeAnalyzer?.create) throw new Error('HeartPy RealtimeAnalyzer not available');
        console.log('Creating analyzer with samplingRate:', fsForAnalyzer);
        try {
          const g: any = global as any;
          if (!warnedJSIFallbackRef.current && !(g && typeof g.__hpRtCreate === 'function')) {
            console.warn('HeartPy JSI not available; using NativeModule for streaming');
            warnedJSIFallbackRef.current = true;
          }
        } catch {}
        try {
          analyzerRef.current = await HP.RealtimeAnalyzer.create(fsForAnalyzer, {
            bandpass: { lowHz: 0.7, highHz: 3.5, order: 2 },
            welch: { nfft: 512, overlap: 0.5 },
            peak: { refractoryMs: 320, thresholdScale: 0.6, bpmMin: 50, bpmMax: 150 },
            preprocessing: { removeBaselineWander: true }
          });
          console.log('Real native analyzer created successfully');
        } catch (createError) {
          console.error('Native analyzer creation failed:', createError);
          throw createError;
        }
        console.log('Analyzer created successfully:', !!analyzerRef.current);
        setStatusMessage('🔴 Gerçek PPG analizi aktif - veriler akıyor');
      } catch (error) {
        console.error('Start analysis error:', error);
        try { console.error('Error type:', typeof error); } catch {}
        // Avoid accessing non-standard properties on unknown error
        try { console.error('Error string:', String(error)); } catch {}
        setIsAnalyzing(false);
        setIsActive(false); // Kamerayı da kapat
        setStatusMessage('❌ Başlatma hatası');
      }
    }
  };

  // Activate camera once device becomes available after permission
  useEffect(() => {
    if (isAnalyzing && pendingActivateRef.current && hasPermission && device) {
      console.log('🟢 Device ready after permission; activating camera');
      pendingActivateRef.current = false;
      setIsActive(true);
      setStatusMessage('Analiz başlatıldı');
    }
  }, [isAnalyzing, hasPermission, device]);

  // Component unmount temizleme
  useEffect(() => {
    return () => {
      if (analyzerRef.current) {
        try {
          analyzerRef.current.destroy();
        } catch (cleanupError) {
          console.error('Cleanup analyzer destroy failed:', cleanupError);
        }
      }
      if (torchTimerRef.current) {
        clearTimeout(torchTimerRef.current);
        torchTimerRef.current = null;
      }
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
    };
  }, []);

  // Debug info
  useEffect(() => {
    console.log('Camera permission status:', hasPermission);
    console.log('Camera device available:', !!device);
  }, [hasPermission, device]);
  
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>📱 Kamera PPG - Kalp Atışı Ölçümü</Text>
      
      {/* Kamera Görünümü */}
      <View style={styles.cameraCircle}>
        {device && hasPermission ? (
          // Spread fps prop conditionally to avoid iOS format reconfig issues
          <Camera
            style={styles.camera}
            device={device}
            isActive={isActive}
            frameProcessor={isActive ? frameProcessor : undefined} // Minimal frame processor test
            {...(Platform.OS === 'android' ? { fps: targetFps } : {})}
            torch={device?.hasTorch && torchOn ? 'on' : 'off'}
            onError={(error) => {
              console.error('🔴 Camera error:', error);
              console.error('🔴 Camera error code:', error.code);
              console.error('🔴 Camera error message:', error.message);
              console.error('🔴 Camera error cause:', error.cause);
              setIsActive(false);
              setIsAnalyzing(false);
              setStatusMessage('❌ Kamera hatası: ' + error.message);
            }}
            onInitialized={() => {
              console.log('🟢 Camera initialized successfully');
              // Enable torch for PPG on both platforms
              if (device?.hasTorch && isAnalyzing) {
                setTimeout(() => {
                  setTorchOn(true);
                  try { torchOnTimeRef.current = Date.now(); } catch {}
                  console.log('🔦 Torch enabled for PPG measurement');
                }, 300);
              }
            }}
          />
        ) : (
          <View style={styles.cameraPlaceholder}>
            <Text style={styles.permissionText}>
              {!hasPermission ? 'Kamera izni gerekiyor' : 'Kamera hazırlanıyor...'}
            </Text>
          </View>
        )}
        {/* Exposure badge removed in this pass */}
        {!isActive && (
          <View style={styles.cameraOverlay}>
            <Text style={styles.overlayText}>Kamera Hazır</Text>
          </View>
        )}
      </View>

      {/* Durum ve Kontroller */}
      <Text style={styles.status}>{statusMessage}</Text>
      
      {/* Hızlı durum butonları: Kontrolleri aç / Başlat */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.mainButton, isAnalyzing ? styles.stopButton : styles.startButton]} 
          onPress={toggleAnalysis}
          disabled={false}
        >
          {isAnalyzing ? (
            <View style={styles.buttonContentRow}>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.buttonText, styles.buttonTextWithIcon]}>Dur</Text>
            </View>
          ) : (
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.buttonText}>▶️ Başlat</Text>
          )}
        </TouchableOpacity>





      </View>

      {/* Durum Özeti - Sadece Güven Skoru */}
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          📊 PPG Analizi: {useNativePPG ? 'GERÇEKPPGPlugin' : 'KAPALI'} • FPS: {targetFps} • ROI: {roi} • 📳: {hapticEnabled ? 'ON' : 'OFF'}
        </Text>
        <View style={[styles.qualityPill, { backgroundColor: confColor }]}> 
          <Text numberOfLines={1} style={styles.qualityPillText}>{Math.round(finalConfidence * 100)}%</Text>
        </View>
      </View>



      {/* PPG Sinyali Gösterimi - Kalp Grafiği */}
      {ppgSignal.length > 0 && (
        <View style={styles.signalContainer}>
          <Text style={styles.signalTitle}>💓 PPG Kalp Grafiği (son {ppgSignal.length} sample)</Text>
          <Text style={styles.signalText}>
            Frame: {frameCount} | Buffer: {frameBufferRef.current.length}
          </Text>
          
          {/* Basit PPG Waveform Grafiği */}
          <View style={styles.waveformContainer}>
            {ppgSignal.slice(-50).map((value, index) => {
              // Normalize value to 0-100 height
              const minVal = Math.min(...ppgSignal);
              const maxVal = Math.max(...ppgSignal);
              const normalizedHeight = maxVal > minVal 
                ? ((value - minVal) / (maxVal - minVal)) * 100 
                : 50;
              
              return (
                <View
                  key={index}
                  style={[
                    styles.waveformBar,
                    { 
                      height: Math.max(2, normalizedHeight),
                      backgroundColor: normalizedHeight > 70 ? '#ff4444' : 
                                     normalizedHeight > 40 ? '#ff8800' : '#44ff44'
                    }
                  ]}
                />
              );
            })}
          </View>
          
          {/* PPG Value Range */}
          {ppgSignal.length > 10 && (
            <Text style={styles.rangeText}>
              Range: {String(Math.min(...ppgSignal).toFixed(0))} - {String(Math.max(...ppgSignal).toFixed(0))}
            </Text>
          )}
        </View>
      )}

      {/* Real-time Metrikler */}
      {metrics && metrics.bpm != null && (
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsTitle}>📊 Real-time Metrikler</Text>
          
          <View style={styles.metricsGrid}>
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{String(metrics.bpm?.toFixed?.(0) ?? '—')}</Text>
              <Text style={styles.metricLabel}>BPM</Text>
            </View>
            
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{String(((metrics.confidence ?? 0) * 100).toFixed(0))}%</Text>
              <Text style={styles.metricLabel}>Güven</Text>
            </View>
            
            <View style={styles.metricBox}>
              <Text style={styles.metricValue}>{String(metrics.snrDb?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.metricLabel}>SNR dB</Text>
            </View>
          </View>

          <View style={styles.detailedMetrics}>
            <Text style={styles.detailText}>RMSSD: {String(metrics.rmssd?.toFixed?.(1) ?? '—')} ms</Text>
            <Text style={styles.detailText}>SDNN: {String(metrics.sdnn?.toFixed?.(1) ?? '—')} ms</Text>
            <Text style={styles.detailText}>pNN50: {String(((metrics.pnn50 ?? 0) * 100).toFixed(1))}%</Text>
            <Text style={styles.detailText}>LF/HF: {String(metrics.lfhf?.toFixed?.(2) ?? '—')}</Text>
            <Text style={styles.detailText}>Nefes: {String(metrics.breathingRate?.toFixed?.(2) ?? '—')} Hz</Text>
            <Text style={styles.detailText}>PPG Conf (plugin): {String(((pluginConfidence ?? 0) * 100).toFixed(0))}%</Text>
            <Text style={styles.detailText}>
              Final Güven: {String((
                (0.5 * (metrics.confidence ?? 0) + 0.5 * (pluginConfidence ?? 0)) * 100
              ).toFixed(0))}%
            </Text>
            <Text style={styles.detailText}>
              Kalite: {String(metrics.quality.totalBeats)} atış, 
              {String(metrics.quality.rejectedBeats)} reddedilen 
              ({String((metrics.quality.rejectionRate * 100).toFixed(0))}%)
            </Text>
          </View>

          {(() => {
            try {
              if (!rawResult) return null;
              
              return (
                <View style={styles.detailedMetrics}>
                  <Text style={styles.detailText}>📊 Detaylı Analiz Sonuçları</Text>
                  
                  {/* Safe BPM via RR */}
                  {Array.isArray(rawResult?.rrList) && rawResult.rrList.length > 0 && (
                    <Text style={styles.detailText}>
                      BPM (RR): {(() => { 
                        try {
                          const rr = rawResult.rrList as number[]; 
                          const mean = rr.reduce((a: number,b: number)=>a+b,0)/rr.length; 
                          return String(isFinite(mean)&&mean>1e-6 ? (60000/mean).toFixed(0) : '—');
                        } catch { return '—'; }
                      })()}
                    </Text>
                  )}
                  
                  {/* Safe Time Domain */}
                  {typeof rawResult?.sdsd === 'number' && (
                    <Text style={styles.detailText}>SDSD: {String(rawResult.sdsd.toFixed(1))}</Text>
                  )}
                  {typeof rawResult?.pnn20 === 'number' && (
                    <Text style={styles.detailText}>pNN20: {String((rawResult.pnn20 * 100).toFixed(1))}%</Text>
                  )}
                  {typeof rawResult?.nn20 === 'number' && (
                    <Text style={styles.detailText}>NN20: {String(rawResult.nn20.toFixed(0))}</Text>
                  )}
                  {typeof rawResult?.nn50 === 'number' && (
                    <Text style={styles.detailText}>NN50: {String(rawResult.nn50.toFixed(0))}</Text>
                  )}
                  {typeof rawResult?.mad === 'number' && (
                    <Text style={styles.detailText}>MAD: {String(rawResult.mad.toFixed(1))}</Text>
                  )}
                  
                  {/* Safe Poincaré */}
                  {(typeof rawResult?.sd1 === 'number' || typeof rawResult?.sd2 === 'number') && (
                    <Text style={styles.detailText}>
                      SD1/SD2: {String((rawResult?.sd1 ?? 0).toFixed(1))} / {String((rawResult?.sd2 ?? 0).toFixed(1))}
                    </Text>
                  )}
                  
                  {/* Safe Quality Summary Only */}
                  {rawResult?.quality && (
                    <Text style={styles.detailText}>
                      Kalite Özeti: {String(rawResult.quality.totalBeats ?? 0)} atış, 
                      {String(rawResult.quality.rejectedBeats ?? 0)} reddedilen
                    </Text>
                  )}
                </View>
              );
            } catch (error) {
              console.error('Detailed metrics render error:', error);
              return (
                <View style={styles.detailedMetrics}>
                  <Text style={styles.detailText}>⚠️ Detaylı metrikler yüklenemiyor</Text>
                </View>
              );
            }
          })()}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
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
  cameraCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    overflow: 'hidden',
    marginBottom: 12,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  button: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 6,
    flexBasis: '48%',
  },
  mainButton: {
    flexBasis: '100%',
  },
  hapticButton: {
    paddingVertical: 0,
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
    lineHeight: 22,
    textAlignVertical: 'center',
  },
  buttonTextWithIcon: {
    marginLeft: 8,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hapticButtonText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    textAlignVertical: 'center',
  },
  permissionText: {
    textAlign: 'center',
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  infoText: {
    color: '#666',
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  qualityPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityPillText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  cameraPlaceholder: {
    height: 220,
    backgroundColor: '#e9ecef',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
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
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  waveformBar: {
    width: 3,
    marginHorizontal: 0.5,
    borderRadius: 1,
  },
  rangeText: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
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
