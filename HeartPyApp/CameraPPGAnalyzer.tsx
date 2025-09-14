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
  AppState,
} from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage'; // Optional - not needed for basic functionality
// Haptics is optional; load lazily to avoid crash if native module is missing
let OptionalHaptics: any | null = null;
function getHaptics(): any | null {
  if (OptionalHaptics !== null) {
    console.log('🎯 Haptics already loaded:', !!OptionalHaptics);
    return OptionalHaptics;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-haptic-feedback');
    OptionalHaptics = mod && (mod.default ? mod.default : mod);
    console.log('🎯 Haptics loaded successfully:', !!OptionalHaptics);
    console.log('🎯 Haptics methods:', OptionalHaptics ? Object.keys(OptionalHaptics) : 'none');
  } catch (e) {
    OptionalHaptics = null;
    console.error('🚨 react-native-haptic-feedback not available:', e);
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
    confidence?: number;  // C++ quality confidence
    snrDb?: number;       // C++ quality SNR
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
  const hapticEnabled = true; // Always ON - no state needed
  const [lastPeakIndices, setLastPeakIndices] = useState<number[]>([]);  // Peak takibi için
  const [hapticPeakCount, setHapticPeakCount] = useState(0);  // Haptic tetiklenen peak sayısı
  const [missedPeakCount, setMissedPeakCount] = useState(0);  // Atlanan peak sayısı
  const [torchOn, setTorchOn] = useState(false); // Auto-controlled
  const [useNativePPG, setUseNativePPG] = useState(true); // Fixed ON - ONLY REAL PPG DATA
  const [roi, setRoi] = useState(0.4); // Fixed optimal
  // Use green + chrom for improved SNR and robustness
  const [ppgChannel, setPpgChannel] = useState<'green' | 'red' | 'luma'>('green');
  const [ppgMode, setPpgMode] = useState<'mean' | 'chrom' | 'pos'>('chrom');
  const [ppgGrid, setPpgGrid] = useState<1 | 2 | 3>(1); // Fixed optimal
  const [pluginConfidence, setPluginConfidence] = useState<number>(0);
  const [autoSelect, setAutoSelect] = useState(false); // Face mode disabled; keep blend OFF
  const [metricsTab, setMetricsTab] = useState<'Özet' | 'Zaman' | 'Frekans' | 'Kalite' | 'Ham'>('Özet');
  // FSM ve süre-bazlı histerezis sayaçları
  const coverStableCountRef = useRef(0);
  const uncoverStableCountRef = useRef(0);
  const coverStableMsRef = useRef(0);
  const uncoverStableMsRef = useRef(0);
  const qualityLowMsRef = useRef(0);
  const lastPollTsRef = useRef<number>(0);
  const lastAutoToggleAtRef = useRef(0);
  const analyzeStartTsRef = useRef(0);
  const warmupUntilRef = useRef(0);
  const fsmRef = useRef<'idle'|'starting'|'warmup'|'running'|'stopping'|'cooldown'>('idle');
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
  
  // UI confidence indicator strictly from C++: quality.confidence
  const cppConfidence = Math.max(0, Math.min(1, metrics?.quality?.confidence ?? 0));
  const confColor = cppConfidence >= 0.7 ? '#4CAF50' : cppConfidence >= 0.4 ? '#FB8C00' : '#f44336';

  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });
  const { hasPermission, requestPermission } = useCameraPermission();

  const analyzerRef = useRef<any | null>(null);
  const [targetFps, setTargetFps] = useState(30); // Optimal FPS for PPG
  const [analyzerFs, setAnalyzerFs] = useState(30); // matched to targetFps
  const samplingRate = analyzerFs; // keep analyzer in sync with actual fps
  const bufferSize = samplingRate * 15; // 15 saniye buffer - daha stabil BPM için
  const analysisInterval = 1000; // 1000ms'de bir analiz - STABİL sonuçlar için

  // FSM kontrollü başlat/durdur yardımcıları
  // Konfig (tek noktadan)
  const CFG = {
    CONF_HIGH: 0.35,  // ✅ Gerçekçi yüksek threshold  
    CONF_LOW: 0.15,   // ✅ Gerçekçi düşük threshold
    HIGH_DEBOUNCE_MS: 800,   // ✅ Biraz daha uzun start koruması
    LOW_DEBOUNCE_MS: 1200,   // ✅ Premature stop önleme
    WARMUP_MS: 3000,         // ✅ 3s warmup uygun
    MIN_RUN_MS: 7000,        // ✅ 7s minimum run uygun  
    COOLDOWN_MS: 3000,       // ✅ 3s cooldown daha güvenli
    // PRETORCH_IGNORE_FRAMES kaldırıldı - hiç veri atılmıyor
  } as const;

  const resetStabilityCounters = useCallback(() => {
    coverStableCountRef.current = 0;
    uncoverStableCountRef.current = 0;
    coverStableMsRef.current = 0;
    uncoverStableMsRef.current = 0;
    qualityLowMsRef.current = 0;
  }, []);

  const startAnalysisFSM = useCallback(async () => {
    const now = Date.now();
    if (fsmRef.current !== 'idle' || isAnalyzing) return;
    
    console.log('🟢 FSM Start: idle → starting');
    fsmRef.current = 'starting';
    lastAutoToggleAtRef.current = now;
    analyzeStartTsRef.current = now;
    warmupUntilRef.current = now + CFG.WARMUP_MS;
    setStatusMessage('✅ Parmak algılandı, analiz başlatılıyor...');
    resetStabilityCounters();
    
    // Torch aç (analyzer'dan önce, parmak algılandığı anda!)
    try {
      if (device?.hasTorch) {
        setTorchOn(true);
        console.log('🔦 Torch ON - parmak algılandı');
      }
    } catch (e) {
      console.warn('Torch açılamadı:', e);
    }
    
    // Analyzer'ı başlat
    try {
      setIsAnalyzing(true);
      setIsActive(true);
      
      console.log('🔄 FSM creating analyzer...');
      const HP = getHeartPy();
      if (!HP?.RealtimeAnalyzer?.create) {
        throw new Error('HeartPy RealtimeAnalyzer not available');
      }
      
      analyzerRef.current = await HP.RealtimeAnalyzer.create(analyzerFs, {
        bandpass: { lowHz: 0.4, highHz: 3.5, order: 2 },
        welch: { nfft: 2048, overlap: 0.75 },
        peak: { 
          refractoryMs: 450,
          thresholdScale: 0.6,
          bpmMin: 50,
          bpmMax: 120
        },
        preprocessing: { 
          removeBaselineWander: true,
          smoothingWindowMs: 100
        },
        quality: {
          cleanRR: true,
          cleanMethod: 'iqr'
        }
      });
      
      console.log('✅ FSM analyzer created successfully');
      // starting state'inde kal, warmup süresi kontrolü performRealtimeAnalysis'de yapılıyor
      // fsmRef.current = 'starting'; // zaten starting'de
      
    } catch (error) {
      console.error('Start FSM error:', error);
      fsmRef.current = 'idle';
      setIsAnalyzing(false);
      setIsActive(false);
      setStatusMessage('❌ Başlatma hatası');
    }
  }, [device, isAnalyzing, analyzerFs]);

  const stopAnalysisFSM = useCallback(async (reason: string = 'manual') => {
    const now = Date.now();
    if (fsmRef.current === 'idle' || fsmRef.current === 'stopping') return;
    
    console.log('🔴 FSM Stop:', fsmRef.current, '→ stopping', 'reason=', reason);
    fsmRef.current = 'stopping';
    lastAutoToggleAtRef.current = now;
    setStatusMessage('⏹️ Analiz durduruluyor...');
    
    // Doğrudan analyzer'ı durdur (clean FSM implementation)
    try {
      setIsAnalyzing(false);
      setIsActive(false);
      
      if (analyzerRef.current) {
        await analyzerRef.current.destroy();
        analyzerRef.current = null;
        console.log('🔴 Analyzer destroyed');
      }
      
      // Clean all timers
      if (torchTimerRef.current) {
        clearTimeout(torchTimerRef.current);
        torchTimerRef.current = null;
      }
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
      
      // Cleanup state
      frameBufferRef.current = [];
      pendingSamplesRef.current = [];
      globalFrameCounter.current = 0;
      setMetrics(null);
      setPpgSignal([]);
      setLastBeatCount(0);
      setFrameCount(0);
      setHapticPeakCount(0);
      setMissedPeakCount(0);
      
    } catch (error) {
      console.error('Stop FSM error:', error);
    } finally {
      try { setTorchOn(false); } catch {}
      // sayaç reset & idle
      resetStabilityCounters();
      analyzeStartTsRef.current = 0; 
      warmupUntilRef.current = 0;
      fsmRef.current = 'idle';
      setStatusMessage('📷 Parmağınızı kamerayı tamamen kapatacak şekilde yerleştirin');
    }
  }, [isAnalyzing, resetStabilityCounters]);

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

  // Analyzer parameters moved up to FSM section - duplicate removed
  
  const frameBufferRef = useRef<number[]>([]);
  const lastAnalysisTimeRef = useRef<number>(0);
  const pendingSamplesRef = useRef<number[]>([]); // incremental push queue
  const startTimeRef = useRef<number>(0);
  const torchTimerRef = useRef<any>(null);
  const simulationTimerRef = useRef<any>(null);
  const torchOnTimeRef = useRef<number | null>(null);
  // const preTorchFramesRef = useRef<number>(0); // ✅ Kaldırıldı - artık kullanılmıyor
  const warnedJSIFallbackRef = useRef(false);
  const lastHapticTimeRef = useRef<number>(0);  // Haptic feedback zamanlaması için
  // const testHapticIntervalRef = useRef<any>(null);  // ✅ Kaldırıldı - kullanılmıyor

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
  }, []);

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
  
  // (removed) legacy duplicate polling effect; consolidated below with confidence/timestamps

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
            const v = plugin.call(frame, { roi, channel: ppgChannel, step: 2, mode: ppgMode, grid: ppgGrid, blend: 'off', torch: !!torchOn }) as number;
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
        let confVal = 0;
        if (typeof conf === 'number' && isFinite(conf)) {
          setPluginConfidence(conf);
          confVal = conf;
        }
        let latestSamples: number[] = [];
        let latestTs: number[] | null = null;
        if (pack && Array.isArray(pack)) {
          latestSamples = (pack as any[]).slice(-20).map(s => (typeof s === 'number' ? s : parseFloat(s))).filter((v: any) => isFinite(v));
        } else if (pack && typeof pack === 'object') {
          const xs = Array.isArray(pack.samples) ? pack.samples : [];
          const ts = Array.isArray(pack.timestamps) ? pack.timestamps : [];
          const k = Math.min(xs.length, ts.length);
          latestSamples = xs.slice(-20).map((s: any) => (typeof s === 'number' ? s : parseFloat(s))).filter((v: any) => isFinite(v));
          latestTs = ts.slice(-20).map((t: any) => (typeof t === 'number' ? t : parseFloat(t))).filter((v: any) => isFinite(v));
        }
        // Confidence-based gating + süre-bazlı histerezis
        const nowTs = Date.now();
        const dt = lastPollTsRef.current ? Math.max(1, nowTs - lastPollTsRef.current) : 200;
        lastPollTsRef.current = nowTs;
        if (confVal >= CFG.CONF_HIGH) {
          coverStableMsRef.current += dt;
          uncoverStableMsRef.current = 0;
        } else if (confVal <= CFG.CONF_LOW) {
          uncoverStableMsRef.current += dt;
          coverStableMsRef.current = 0;
        } else {
          // orta bölgede yavaş çözülme
          coverStableMsRef.current = Math.max(0, coverStableMsRef.current - dt/2);
          uncoverStableMsRef.current = Math.max(0, uncoverStableMsRef.current - dt/2);
        }
        const GATE = 0.05;  // örnek akışını kesmeyelim
        const gateOK = confVal >= GATE || latestSamples.length > 0;
        if (latestSamples.length > 0 && gateOK) {
          // ✅ Warmup'ta da tüm veriler işlenir, hiç veri atılmaz
          
          // Update UI and incremental queue
          latestSamples.forEach((val, i) => {
            frameBufferRef.current.push(val);
            if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();
            pendingSamplesRef.current.push(val);
            if (pendingSamplesRef.current.length > bufferSize) pendingSamplesRef.current.splice(0, pendingSamplesRef.current.length - bufferSize);
          });
          setPpgSignal(prev => {
            const next = [...prev, ...latestSamples];
            const trimmed = next.length > 150 ? next.slice(-150) : next;
            // Haptic tetiği yalnızca C++ analizindeki beat artışına göre verilir (aşağıda)
            
            return trimmed;
          });
          // If timestamps available and analyzer supports, push with timestamps now (optional)
          try {
            if (latestTs && latestTs.length === latestSamples.length && analyzerRef.current?.pushWithTimestamps && gateOK) {
              const xs = new Float32Array(latestSamples);
              const ts = new Float64Array(latestTs);
              await analyzerRef.current.pushWithTimestamps(xs, ts);
              // ✅ ÖNEMLİ: pendingSamplesRef'i temizle çünkü data push edildi!
              pendingSamplesRef.current = [];
            }
          } catch (e) {
            console.warn('pushWithTimestamps failed, will use regular push:', e);
            // Hata durumunda pendingSamplesRef dolu kalır, normal push kullanılır
          }
        }
        // Otomatik başlat/durdur: süre-bazlı histerezis + cooldown + min-run
        try {
          const now = Date.now();
          const ranMs = now - (analyzeStartTsRef.current || 0);
          const coolOK = now - (lastAutoToggleAtRef.current || 0) >= CFG.COOLDOWN_MS;
          // IDLE → STARTING: high debounce sağlandıysa ve cooldown geçtiyse
          if (!isAnalyzing && fsmRef.current === 'idle' && coverStableMsRef.current >= CFG.HIGH_DEBOUNCE_MS && coolOK) {
            await startAnalysisFSM();
          }
          // RUNNING → STOPPING: low debounce + min run + cooldown
          if (isAnalyzing && fsmRef.current === 'running' && uncoverStableMsRef.current >= CFG.LOW_DEBOUNCE_MS && ranMs >= CFG.MIN_RUN_MS && coolOK) {
            await stopAnalysisFSM('auto');
          }
          // ✅ STARTING (warmup) → STOPPING: erken parmak kalkması (daha kısa süre)
          if (isAnalyzing && fsmRef.current === 'starting' && uncoverStableMsRef.current >= CFG.LOW_DEBOUNCE_MS && ranMs >= 2000 && coolOK) {
            await stopAnalysisFSM('early_stop_warmup');
          }
        } catch {}

        // Torch control FSM tarafından yönetiliyor - manuel müdahale yok
      } catch (e) {
        // occasional polling errors are non-fatal
      }
    }, 200);  // 200ms - STABIL polling interval
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
      // En az 8 saniye veri toplandıktan sonra analiz başlat (STABIL BPM için)
      const minBufferSize = samplingRate * 8;  // 8 saniye minimum veri - stabil sonuçlar
      if (now - lastAnalysisTimeRef.current > analysisInterval && frameBufferRef.current.length >= minBufferSize) {
        lastAnalysisTimeRef.current = now;
        performRealtimeAnalysis();
      }
    }, 1000 / 15); // 15 FPS UI update
    
    return () => clearInterval(uiUpdateTimer);
  }, [isActive, analysisInterval, samplingRate, bufferSize, useNativePPG]);

  // Sayfa açıldığında izin/cihaz hazırsa kamerayı etkinleştir (torch pulse hazırda)
  useEffect(() => {
    if (hasPermission && device) {
      if (!isActive) setIsActive(true);
      if (!isAnalyzing) setStatusMessage('📷 Parmağınızı kamerayı tamamen kapatacak şekilde yerleştirin');
    }
  }, [hasPermission, device]);

  // Test haptic devre dışı: Haptic sadece C++ beat artışında tetiklenir

  // (removed) exposure badge derivation; consider dynamic gate later

  // Face mode disabled: always run red + mean (contact PPG).

  // Real-time analiz - incremental streaming push + metric poll
  const performRealtimeAnalysis = async () => {
    if (!analyzerRef.current) {
      console.log('⚠️ Analyzer not initialized!');
      return;
    }

    console.log('🔄 Starting realtime analysis...');
    
    try {
      // Push only new samples accumulated since last call
      const pending = pendingSamplesRef.current;
      console.log(`📥 Pushing ${pending.length} samples to C++ analyzer`);
      
      if (pending.length > 0) {
        const samplesArray = new Float32Array(pending);
        // Validate samples array
        if (!samplesArray.every(s => typeof s === 'number' && isFinite(s))) {
          console.warn('Invalid samples in pending queue');
        } else {
          try {
            await analyzerRef.current.push(samplesArray);
            console.log('✅ Samples pushed to C++ analyzer successfully');
          } catch (pushError) {
            console.error('Native analyzer push failed:', pushError);
            setStatusMessage('❌ Native analyzer push hatası');
            // ✅ Push hatası durumunda FSM'i sıfırla
            await stopAnalysisFSM('push_error');
            return;
          }
        }
        // Clear pending after push
        pendingSamplesRef.current = [];
      }
      
      // Metrikleri al - defensive native call
      let result;
      try {
        console.log('🔍 Polling C++ analyzer for results...');
        result = await analyzerRef.current.poll();
        console.log('✅ C++ analyzer poll successful');
      } catch (pollError) {
        console.error('🔥 Native analyzer poll failed:', pollError);
        setStatusMessage('❌ Native analyzer poll hatası');
        // ✅ Poll hatası durumunda FSM'i sıfırla
        await stopAnalysisFSM('poll_error');
        return;
      }
      
      if (result && typeof result === 'object') {
        try { setRawResult(result as any); } catch {}
        
        // Debug: Native analyzer sonuçlarını logla
        console.log('🔥 NATIVE C++ ANALYZER RESULT:', {
          'C++ BPM': result.bpm,
          'RR Count': Array.isArray(result.rrList) ? result.rrList.length : 0,
          'Peak Count': Array.isArray(result.peakList) ? result.peakList.length : 0,
          'C++ Confidence': (result as any).quality?.confidence,
          'C++ SNR': (result as any).quality?.snrDb,
          'Total Beats': (result as any).quality?.totalBeats,
          'Result Type': typeof result.bpm,
          'Is Finite': isFinite(result.bpm || 0)
        });
        
        try {
          // C++ NATIVE BPM'İNİ AYNEN KULLAN - HİÇ DEĞİŞTİRME!
          const calculatedBpm = typeof result.bpm === 'number' ? result.bpm : 0;
          
          console.log(`🎯 C++ Native BPM (değiştirilmeden): ${calculatedBpm.toFixed(1)}`);
          
          const newMetrics: any = result;
          
          // C++ BPM AYNEN KULLANILIYOR - HİÇ DEĞİŞİKLİK YOK
          console.log(`✅ UI'da gösterilecek BPM: ${calculatedBpm.toFixed(1)} (C++ orijinal değeri)`);
          
          setMetrics(newMetrics as PPGMetrics);
          
        // C++ analizindeki beat artışına göre haptic feedback (kalite koşulu ile)
        const currentBeatCount = (newMetrics as any).quality?.totalBeats ?? 0;
        const cppConf = (newMetrics as any).quality?.confidence ?? 0;
        const goodQ = !!(newMetrics as any).quality?.goodQuality;
        // ✅ İyileştirilmiş haptic: running durumu + daha esnek confidence threshold
        if (currentBeatCount > lastBeatCount && fsmRef.current === 'running' && goodQ && cppConf >= 0.3) {
          const now = Date.now();
          const refractoryMs = 250; // darbeler arası min süre
          if (!lastHapticTimeRef.current || now - lastHapticTimeRef.current >= refractoryMs) {
            try {
              const Haptics = getHaptics();
              if (Haptics) {
                Haptics.trigger(Platform.OS === 'ios' ? 'impactLight' : 'impactMedium', hapticOptions);
                setHapticPeakCount(prev => prev + 1);
              }
            } catch {}
            lastHapticTimeRef.current = now;
          } else {
            setMissedPeakCount(prev => prev + 1);
          }
        }
        
        // Peak listesini güncelle (görsel için)
        if (Array.isArray(result.peakList) && result.peakList.length > 0) {
          setLastPeakIndices(result.peakList.slice(-100));
        }
        
        // Beat count değişimi logu
        if (currentBeatCount > lastBeatCount) {
          console.log(`💓 ${currentBeatCount - lastBeatCount} new beat(s)! Total: ${currentBeatCount}`);
          setLastBeatCount(currentBeatCount);
        }
          
          // Status mesajını güncelle + FSM warmup transition
          const nowTs = Date.now();
          const inWarmup = nowTs < (warmupUntilRef.current || 0);
          
          // FSM: Warmup bitiminde parmak/konf tekrar doğrulaması
          if (!inWarmup && fsmRef.current === 'starting') {
            const confNow = (newMetrics as any)?.quality?.confidence ?? 0;
            console.log(`🟡 Warmup complete, checking confidence: ${confNow.toFixed(2)} vs ${CFG.CONF_HIGH}`);
            if (confNow >= CFG.CONF_HIGH) {
              console.log('🟡 Warmup OK → running');
              fsmRef.current = 'running';
            } else {
              console.log('🔴 Warmup bitti ama conf düşük → stop');
              await stopAnalysisFSM('no_finger_after_warmup');
              return;
            }
          }
          
          if (inWarmup) {
            setStatusMessage('⏳ Isınma: pozlama/sinyal oturuyor...');
          } else if ((newMetrics as any).quality?.goodQuality) {
            setStatusMessage(`✅ Kaliteli sinyal - BPM: ${newMetrics.bpm?.toFixed?.(0) ?? '—'} 💓 ${String(currentBeatCount)} beat`);
          } else {
            setStatusMessage(`⚠️ Zayıf sinyal - ${(newMetrics as any).quality?.qualityWarning || 'Parmağınızı kameraya daha iyi yerleştirin'}`);
          }
        } catch (metricsError) {
          console.error('Metrics processing error:', metricsError);
          if (metricsError instanceof Error) {
            console.error('Error stack:', metricsError.stack);
          }
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

  // Analizi başlat/durdur - FSM state'ini güncelle
  const toggleAnalysis = async () => {
    console.log('🔵 toggleAnalysis called, isAnalyzing:', isAnalyzing, 'FSM:', fsmRef.current);
    if (isAnalyzing) {
      // Durdur - FSM state'ini idle'a çevir
      console.log('🔴 Stopping analysis, FSM: running → idle');
      fsmRef.current = 'idle';
      setIsAnalyzing(false);
      setIsActive(false);
      setTorchOn(false);
      // preTorchFramesRef.current = 0; // ✅ Kaldırıldı - artık kullanılmıyor
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
      setHapticPeakCount(0);
      setMissedPeakCount(0);
      setStatusMessage('Analiz durduruldu');
    } else {
      // Başlat - FSM state kontrolü
      console.log('🟢 Starting analysis...');
      
      // Eğer FSM idle ise starting'e çevir, değilse mevcut state'i koru
      if (fsmRef.current === 'idle') {
        console.log('🟢 FSM: idle → starting (manual)');
        fsmRef.current = 'starting';
      }
      
      try {
        console.log('🟢 Setting isAnalyzing to true');
        setIsAnalyzing(true);
        setStatusMessage('⏳ Analiz başlatılıyor...');
        startTimeRef.current = Date.now();
        setLastBeatCount(0);
        setFrameCount(0);
        setPpgSignal([]);
        setHapticPeakCount(0);
        setMissedPeakCount(0);
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
          // Torch kullanımını kapattık (enerji ve thrash önlemek için)
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
          // PPG sinyali için STABİL parametreler
          analyzerRef.current = await HP.RealtimeAnalyzer.create(fsForAnalyzer, {
            // Daha geniş bandpass - stabil sonuçlar için
            bandpass: { lowHz: 0.4, highHz: 3.5, order: 2 },
            // Daha büyük FFT - daha stabil frekans analizi
            welch: { nfft: 2048, overlap: 0.75 },
            // STABİL peak detection parametreleri
            peak: { 
              refractoryMs: 450,      // Daha konservatif - yanlış peak'leri önler
              thresholdScale: 0.6,    // Daha yüksek threshold - stabil peak'ler
              bpmMin: 50,             // Daha dar aralık - stabil BPM
              bpmMax: 120             // Çok yüksek BPM'leri önle
            },
            preprocessing: { 
              removeBaselineWander: true,
              smoothingWindowMs: 100   // Daha fazla smoothing - stabil sinyal
            },
            // RR Temizleme - stabilite için kritik
            quality: {
              cleanRR: true,          // RR interval temizleme aktif
              cleanMethod: 'iqr'      // IQR outlier removal
            }
          });
          console.log('Real native analyzer created with optimized PPG parameters');
        } catch (createError) {
          console.error('Native analyzer creation failed:', createError);
          throw createError;
        }
        console.log('Analyzer created successfully:', !!analyzerRef.current);
        
        // FSM: starting → running + warmup ayarla
        console.log('🟢 Analysis started, FSM: starting → running');
        fsmRef.current = 'running';
        
        // Warmup süresini ayarla (manual veya auto start için)
        if (!warmupUntilRef.current || warmupUntilRef.current < Date.now()) {
          warmupUntilRef.current = Date.now() + 3000; // 3 saniye warmup
        }
        setStatusMessage('⏳ Isınma: pozlama/sinyal oturuyor...');
      } catch (error) {
        console.error('Start analysis error:', error);
        try { console.error('Error type:', typeof error); } catch {}
        // Avoid accessing non-standard properties on unknown error
        try { console.error('Error string:', String(error)); } catch {}
        // Başlatma hatası - FSM'i idle'a çevir
        console.log('🔴 Start error, FSM: starting → idle');
        fsmRef.current = 'idle';
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

      {/* Durum */}
      <Text style={styles.status}>{statusMessage}</Text>

      {/* Durum Özeti - FSM State + Güven Skoru */}
      <View style={styles.infoRow}>
        <Text style={styles.infoText}>
          📊 PPG: {useNativePPG ? 'ON' : 'OFF'} • FPS: {targetFps} • FSM: {fsmRef.current} • 📳: ON
        </Text>
        <View style={[styles.qualityPill, { backgroundColor: confColor }]}> 
          <Text numberOfLines={1} style={styles.qualityPillText}>{Math.round((metrics?.quality?.confidence ?? 0) * 100)}%</Text>
        </View>
      </View>



      {/* PPG Sinyali Gösterimi - Kalp Grafiği */}
      {ppgSignal.length > 0 && (
        <View style={styles.signalContainer}>
          <Text style={styles.signalTitle}>💓 PPG Kalp Grafiği (son {ppgSignal.length} sample)</Text>
          <Text style={styles.signalText}>
            Frame: {frameCount} | Buffer: {frameBufferRef.current.length}
          </Text>
          
          {/* Gelişmiş PPG Waveform Grafiği - Peak'leri göster */}
          <View style={styles.waveformContainer}>
            {ppgSignal.slice(-50).map((value, index, array) => {
              // Normalize value to 0-100 height
              const minVal = Math.min(...ppgSignal);
              const maxVal = Math.max(...ppgSignal);
              const normalizedHeight = maxVal > minVal 
                ? ((value - minVal) / (maxVal - minVal)) * 100 
                : 50;
              
              // Peak detection for visualization
              let isPeak = false;
              if (index > 0 && index < array.length - 1) {
                const prev = array[index - 1];
                const next = array[index + 1];
                const mean = array.reduce((a, b) => a + b, 0) / array.length;
                const std = Math.sqrt(array.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / array.length);
                const threshold = mean + 0.5 * std; // Same threshold as haptic
                
                isPeak = value > threshold && value > prev && value >= next;
              }
              
              return (
                <View
                  key={index}
                  style={[
                    styles.waveformBar,
                    { 
                      height: Math.max(2, normalizedHeight),
                      backgroundColor: isPeak ? '#ff0000' :  // Kırmızı: Peak
                                     normalizedHeight > 70 ? '#ff6666' : 
                                     normalizedHeight > 40 ? '#ffaa00' : '#66ff66',
                      width: isPeak ? 4 : 3, // Peak'ler daha kalın
                    }
                  ]}
                />
              );
            })}
          </View>
          
          {/* PPG Value Range & Peak Stats */}
          {ppgSignal.length > 10 && (
            <>
              <Text style={styles.rangeText}>
                Range: {String(Math.min(...ppgSignal).toFixed(0))} - {String(Math.max(...ppgSignal).toFixed(0))}
              </Text>
              <Text style={styles.peakStatsText}>
                📳 Haptic Peaks: {hapticPeakCount} | ⚠️ Skipped: {missedPeakCount} | 
                Success Rate: {hapticPeakCount > 0 ? `${Math.round((hapticPeakCount / (hapticPeakCount + missedPeakCount)) * 100)}%` : '—'}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Real-time Metrikler */}
      {metrics && (
        <View style={styles.metricsContainer}>
          <Text style={styles.metricsTitle}>📊 Metrikler</Text>

          {/* Tabs */}
          <View style={styles.tabBar}>
            {(['Özet','Zaman','Frekans','Kalite','Ham'] as const).map(t => (
              <TouchableOpacity key={t} style={[styles.tabBtn, metricsTab === t && styles.tabBtnActive]} onPress={() => setMetricsTab(t)}>
                <Text style={[styles.tabText, metricsTab === t && styles.tabTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab Content */}
          {metricsTab === 'Özet' && (
            <View>
              <View style={styles.metricsGrid}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{String(metrics.bpm?.toFixed?.(0) ?? '—')}</Text>
                  <Text style={styles.metricLabel}>BPM</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{String(((metrics.quality?.confidence ?? 0) * 100).toFixed(0))}%</Text>
                  <Text style={styles.metricLabel}>Güven</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricValue}>{String(metrics.quality?.snrDb?.toFixed?.(1) ?? '—')}</Text>
                  <Text style={styles.metricLabel}>SNR dB</Text>
                </View>
              </View>
              <View style={styles.grid2col}>
                <Text style={styles.detailItem}><Text style={styles.detailKey}>Nefes:</Text> {String(metrics.breathingRate?.toFixed?.(2) ?? '—')} Hz</Text>
                <Text style={styles.detailItem}><Text style={styles.detailKey}>LF/HF:</Text> {String(metrics.lfhf?.toFixed?.(2) ?? '—')}</Text>
              </View>
            </View>
          )}

          {metricsTab === 'Zaman' && (
            <View style={styles.grid2col}>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>RMSSD:</Text> {String(metrics.rmssd?.toFixed?.(1) ?? '—')} ms</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>SDNN:</Text> {String(metrics.sdnn?.toFixed?.(1) ?? '—')} ms</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>SDSD:</Text> {String((metrics as any)?.sdsd?.toFixed?.(1) ?? '—')} ms</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>pNN50:</Text> {String(metrics.pnn50?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>pNN20:</Text> {String((metrics as any)?.pnn20?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>NN20:</Text> {String((metrics as any)?.nn20?.toFixed?.(0) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>NN50:</Text> {String((metrics as any)?.nn50?.toFixed?.(0) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>MAD:</Text> {String((metrics as any)?.mad?.toFixed?.(1) ?? '—')}</Text>
            </View>
          )}

          {metricsTab === 'Frekans' && (
            <View style={styles.grid2col}>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>VLF:</Text> {String((metrics as any)?.vlf?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>LF:</Text> {String((metrics as any)?.lf?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>HF:</Text> {String((metrics as any)?.hf?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>LF/HF:</Text> {String(metrics.lfhf?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Toplam Güç:</Text> {String((metrics as any)?.totalPower?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>LF norm:</Text> {String((metrics as any)?.lfNorm?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>HF norm:</Text> {String((metrics as any)?.hfNorm?.toFixed?.(1) ?? '—')}</Text>
            </View>
          )}

          {metricsTab === 'Kalite' && (
            <View style={styles.grid2col}>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>İyi Kalite:</Text> {String(metrics.quality?.goodQuality ?? false)}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Toplam Atış:</Text> {String(metrics.quality?.totalBeats ?? 0)}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Reddedilen:</Text> {String(metrics.quality?.rejectedBeats ?? 0)}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Red Oranı:</Text> {String(((metrics.quality?.rejectionRate ?? 0) * 100).toFixed(0))}%</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Confidence:</Text> {String(((metrics.quality?.confidence ?? 0) * 100).toFixed(0))}%</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>SNR dB:</Text> {String(metrics.quality?.snrDb?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>f0 Hz:</Text> {String((metrics as any)?.quality?.f0Hz?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Uyarı:</Text> {String(metrics.quality?.qualityWarning ?? '—')}</Text>
            </View>
          )}

          {metricsTab === 'Ham' && (
            <View style={styles.grid2col}>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>RR Sayısı:</Text> {String(Array.isArray((metrics as any)?.rrList) ? (metrics as any).rrList.length : 0)}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Peak Sayısı:</Text> {String(Array.isArray((metrics as any)?.peakList) ? (metrics as any).peakList.length : 0)}</Text>
            </View>
          )}
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
  peakStatsText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
    fontWeight: '600',
  },
  metricsContainer: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: '#ffffff',
  },
  tabText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#333',
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
  grid2col: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  detailItem: {
    width: '48%',
    fontSize: 13,
    color: '#333',
    marginBottom: 8,
  },
  detailKey: {
    fontWeight: '600',
    color: '#555',
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
