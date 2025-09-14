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

// const { width, height } = Dimensions.get('window'); // ✅ P1 FIX: Unused - removed

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
  
  // ✅ P1 FIX: C++ top-level arrays 
  rrList?: number[];     // Top-level RR intervals from C++
  peakList?: number[];   // Top-level peak indices from C++
  
  quality: {
    goodQuality: boolean;
    totalBeats: number;
    rejectedBeats: number;
    rejectionRate: number;
    confidence?: number;    // C++ quality confidence
    snrDb?: number;         // C++ quality SNR
    f0Hz?: number;          // C++ fundamental frequency 
    maPercActive?: number;  // C++ moving average percentage
    pHalfOverFund?: number; // C++ P half over fundamental
    acDcRatio?: number;     // ✅ P1 FIX: AC/DC ratio for telemetry
    qualityWarning?: string;
    
    // ✅ PHASE 2: RR Artifact Correction results
    correctedRRList?: number[];
    rrOutlierCount?: number;
    rrCorrectionRatio?: number;
    rrCorrectionMethod?: string;
    
    // ✅ C++ advanced flags
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
  const [roi, setRoi] = useState(0.5); // ✅ Larger ROI for more light collection
  // Use green + chrom for improved SNR and robustness
  const [ppgChannel, setPpgChannel] = useState<'green' | 'red' | 'luma'>('green');
  const [ppgMode, setPpgMode] = useState<'mean' | 'chrom' | 'pos'>('chrom');
  const [ppgGrid, setPpgGrid] = useState<1 | 2 | 3>(3); // ✅ PHASE 2: 3x3 grid for robust multi-ROI
  const [pluginConfidence, setPluginConfidence] = useState<number>(0);
  const [autoSelect, setAutoSelect] = useState(false); // Face mode disabled; keep blend OFF
  const [metricsTab, setMetricsTab] = useState<'Özet' | 'Zaman' | 'Frekans' | 'Kalite' | 'Ham'>('Özet');
  // FSM ve süre-bazlı histerezis sayaçları
  const coverStableCountRef = useRef(0);
  const uncoverStableCountRef = useRef(0);
  const coverStableMsRef = useRef(0);
  const uncoverStableMsRef = useRef(0);
  const qualityLowMsRef = useRef(0);
  const lastPluginPollTsRef = useRef<number>(0);  // ✅ Plugin confidence timing
  const lastCppPollTsRef = useRef<number>(0);     // ✅ C++ quality timing
  const lastAutoToggleAtRef = useRef(0);
  const analyzeStartTsRef = useRef(0);
  const warmupUntilRef = useRef(0);
  const fsmRef = useRef<'idle'|'starting'|'running'|'stopping'>('idle');  // ✅ Sadeleştirildi
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
  
  // ✅ PHASE 1: Camera format (simplified for compatibility)
  // const [cameraFormat, setCameraFormat] = useState<any>(null); // Disabled for now
  const { hasPermission, requestPermission } = useCameraPermission();

  const analyzerRef = useRef<any | null>(null);
  const [targetFps, setTargetFps] = useState(30); // Optimal FPS for PPG
  const [analyzerFs, setAnalyzerFs] = useState(30); // matched to targetFps
  
  // ✅ PHASE 1: Camera Lock Settings
  const [cameraLockEnabled, setCameraLockEnabled] = useState(true);
  const [lockExposure, setLockExposure] = useState<number | undefined>(1/60); // ✅ Longer exposure for better SNR
  const [lockIso, setLockIso] = useState<number | undefined>(100); // ✅ Lower ISO for less noise
  const [lockWhiteBalance, setLockWhiteBalance] = useState<'auto' | 'sunny' | 'cloudy' | 'fluorescent'>('auto');
  const [lockFocus, setLockFocus] = useState<'auto' | 'manual'>('manual');
  const [cameraCapabilities, setCameraCapabilities] = useState<any>(null);
  const [cameraLockStatus, setCameraLockStatus] = useState<any>(null);
  
  // ✅ PHASE 1: Telemetry Events
  const sessionStartRef = useRef<number>(0);
  const torchDutyStartRef = useRef<number>(0);
  const torchTotalDutyRef = useRef<number>(0);
  
  // ✅ CRITICAL: Higher torch for better SNR  
  const [torchLevel, setTorchLevel] = useState<number>(1.0); // ✅ Start with MAX for best SNR
  const torchLevels = [0.3, 0.6, 1.0]; // Progressive levels
  const [currentTorchLevelIndex, setCurrentTorchLevelIndex] = useState(2); // ✅ Start with MAX (1.0)
  
  // ✅ PHASE 2: Multi-ROI Adaptive Management
  const roiQualityHistoryRef = useRef<number[]>([]);
  const [adaptiveROI, setAdaptiveROI] = useState(false); // Enable adaptive ROI sizing
  const [lastROIAdjustment, setLastROIAdjustment] = useState(Date.now());
  
  // ✅ PHASE 2: Signal Quality Tracking
  const signalQualityHistoryRef = useRef<Array<{
    timestamp: number,
    confidence: number,
    snr: number,
    acDc: number,
    gridQuality: number
  }>>([]);
  
  // ✅ PHASE 2: RR Correction State
  const [rrCorrectionEnabled, setRRCorrectionEnabled] = useState(true);
  const [lastRRCorrection, setLastRRCorrection] = useState<{
    outlierCount: number,
    correctionRatio: number,
    method: string
  }>({ outlierCount: 0, correctionRatio: 0, method: 'none' });
  
  // ✅ Telemetry throttling
  const unifiedConfCallCountRef = useRef(0);
  const samplingRate = analyzerFs; // keep analyzer in sync with actual fps
  const bufferSize = samplingRate * 15; // 15 saniye buffer - daha stabil BPM için
  const analysisInterval = 1000; // 1000ms'de bir analiz - STABİL sonuçlar için

  // FSM kontrollü başlat/durdur yardımcıları
  // Konfig (tek noktadan)
  const CFG = {
    CONF_HIGH: 0.35,  // ✅ Conservative - prevent erken warmup'lar
    CONF_LOW: 0.20,   // ✅ Higher threshold for stability
    HIGH_DEBOUNCE_MS: 400,   // ✅ Çok daha kısa - hızlı start
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

  // ✅ CRITICAL: Camera Lock Functions for SNR improvement
  const lockCameraSettings = useCallback(async () => {
    if (!cameraLockEnabled) return null;
    
    try {
      const settings = {
        fps: targetFps,
        exposureDuration: lockExposure,
        iso: lockIso,
        whiteBalance: lockWhiteBalance === 'auto' ? undefined : 'locked',
        focus: lockFocus === 'manual' ? 'locked' : undefined,
        torchLevel: torchLevel
      };
      
      console.log('🔒 Locking camera settings:', settings);
      const result = await NativeModules.PPGCameraManager?.lockCameraSettings(settings);
      setCameraLockStatus(result);
      console.log('✅ Camera lock result:', result);
      logTelemetryEvent('camera_lock_applied', { settings, result });
      return result;
    } catch (error) {
      console.error('❌ Camera lock failed:', error);
      logTelemetryEvent('camera_lock_failed', { error: error.message });
      return null;
    }
  }, [cameraLockEnabled, targetFps, lockExposure, lockIso, lockWhiteBalance, lockFocus, torchLevel]);

  const unlockCameraSettings = useCallback(async () => {
    try {
      console.log('🔓 Unlocking camera settings...');
      const result = await NativeModules.PPGCameraManager?.unlockCameraSettings();
      setCameraLockStatus(null);
      console.log('✅ Camera unlock result:', result);
      logTelemetryEvent('camera_unlock_applied', { result });
      return result;
    } catch (error) {
      console.error('❌ Camera unlock failed:', error);
      logTelemetryEvent('camera_unlock_failed', { error: error.message });
      return null;
    }
  }, []);

  const startAnalysisFSM = useCallback(async () => {
    const now = Date.now();
    if (fsmRef.current !== 'idle' || isAnalyzing) return;
    
    console.log('🟢 FSM Start: idle → starting');
    sessionStartRef.current = now;  // ✅ Session tracking
    logFSMTransition('idle', 'starting', 'auto_or_manual_trigger');
    fsmRef.current = 'starting';
    lastAutoToggleAtRef.current = now;
    analyzeStartTsRef.current = now;
    warmupUntilRef.current = now + CFG.WARMUP_MS;
    
    // ✅ P1 FIX: Reset no-signal timer
    lastSignalCheckRef.current = now;
    
    setStatusMessage('✅ Parmak algılandı, analiz başlatılıyor...');
    resetStabilityCounters();
    
    // ✅ CRITICAL: iOS-only camera settings lock for stable SNR
    if (Platform.OS === 'ios') {
      await lockCameraSettings();
    }
    
    // ✅ P1 FIX: Torch guarantee - ALWAYS ensure torch is ON during analysis
    try {
      if (device?.hasTorch) {
        setTorchOn(true);
        torchDutyStartRef.current = now;  // ✅ Torch duty tracking
        
        // ✅ CRITICAL: iOS-only torch control via PPGCameraManager
        if (Platform.OS === 'ios' && cameraLockEnabled && NativeModules.PPGCameraManager?.setTorchLevel) {
          await NativeModules.PPGCameraManager.setTorchLevel(torchLevel);
          console.log(`🔦 iOS Torch GUARANTEED ON - level: ${torchLevel}`);
        } else {
          console.log('🔦 Torch ON (VisionCamera managed)');
        }
        
        // ✅ P1 FIX: Set pretorch drop period when torch turns on
        pretorchUntilRef.current = now + PRETORCH_DROP_MS;
        
        logTelemetryEvent('torch_state_guarantee', { 
          torchOn: true, 
          level: torchLevel,
          timestamp: now,
          pretorchDropUntil: pretorchUntilRef.current
        });
      }
    } catch (e) {
      console.warn('Torch açılamadı:', e);
      logTelemetryEvent('torch_guarantee_failed', { error: e.message });
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
      
      const analyzerConfig = getAnalyzerConfig();
      console.log(`🔧 Creating ${ANALYZER_PROFILE} analyzer with config:`, analyzerConfig);
      
      analyzerRef.current = await HP.RealtimeAnalyzer.create(analyzerFs, analyzerConfig);
      
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
    
    // ✅ Torch duty calculation
    if (torchDutyStartRef.current > 0) {
      torchTotalDutyRef.current += now - torchDutyStartRef.current;
      torchDutyStartRef.current = 0;
    }
    
    console.log('🔴 FSM Stop:', fsmRef.current, '→ stopping', 'reason=', reason);
    logFSMTransition(fsmRef.current, 'stopping', reason);
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
      try { 
        setTorchOn(false); 
        // ✅ CRITICAL: iOS-only camera unlock when stopping
        if (Platform.OS === 'ios') {
          await unlockCameraSettings();
        }
      } catch {}
      // sayaç reset & idle
      resetStabilityCounters();
      analyzeStartTsRef.current = 0; 
      warmupUntilRef.current = 0;
      logFSMTransition('stopping', 'idle', 'cleanup_complete');
      logSessionOutcome(classifyOutcome(reason), reason, metrics || null);
      fsmRef.current = 'idle';
      setStatusMessage('📷 Parmağınızı kamerayı tamamen kapatacak şekilde yerleştirin');
    }
  }, [isAnalyzing, resetStabilityCounters, classifyOutcome]);

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
  const isAnalyzingRef = useRef(isAnalyzing);  // ✅ Poll interval staleness önleme
  const lastDataAtRef = useRef(Date.now());    // ✅ Watchdog timer için
  
  // ✅ P1 FIX: Producer watchdog & fallback ingest
  const lastSampleAtRef = useRef<number>(0);
  const FALLBACK_AFTER_MS = 800;
  const [enableFallback, setEnableFallback] = useState(false);
  
  // ✅ P1 FIX: No-signal early stop
  const NO_SIGNAL_TIMEOUT_MS = 2000;
  const lastSignalCheckRef = useRef<number>(0);
  
  // ✅ P1 FIX: Pretorch frame drop - avoid torch/AE ramp-up noise
  const PRETORCH_DROP_MS = 400;
  const pretorchUntilRef = useRef<number>(0);
  
  // ✅ DEBUG: Track plugin confidence changes
  const lastLoggedConfRef = useRef<number>(-1);
  
  // ✅ isAnalyzingRef'i güncel tut
  useEffect(() => { 
    isAnalyzingRef.current = isAnalyzing; 
  }, [isAnalyzing]);
  
  // ✅ P1 FIX: Heavy logging throttle - prevent performance degradation
  const DEBUG_HEAVY = false; // ✅ Default OFF for production
  const HEAVY_LOG_THROTTLE = 10; // Log every 10th call
  const heavyLogCountRef = useRef(0);
  
  // ✅ CRITICAL: DEV/PROD Analyzer Presets
  const ANALYZER_PROFILE = 'PROD'; // 'DEV' | 'PROD'
  
  const getAnalyzerConfig = useCallback(() => {
    if (ANALYZER_PROFILE === 'DEV') {
      // DEV: Very permissive for testing/debugging
      return {
        bandpass: { lowHz: 0.4, highHz: 4.5, order: 2 },  
        welch: { nfft: 512, overlap: 0.7 },                
        peak: { 
          refractoryMs: 200,    // Very permissive
          thresholdScale: 0.2,  // Very low threshold
          bpmMin: 30,           
          bpmMax: 240           
        },
        preprocessing: { 
          removeBaselineWander: false,  
          smoothingWindowMs: 20         
        },
        quality: {
          cleanRR: false,         
          cleanMethod: 'none'     
        }
      };
    } else {
      // PROD: Conservative, stable settings with RAW RR processing
      return {
        bandpass: { lowHz: 0.5, highHz: 3.5, order: 3 },  // ✅ Narrower, more stable
        welch: { nfft: 1024, overlap: 0.5 },              // ✅ Higher resolution
        peak: { 
          refractoryMs: 320,    // ✅ Conservative refractory ≈320ms
          thresholdScale: 0.55, // ✅ Conservative threshold ≈0.55
          bpmMin: 40,           // ✅ Realistic range
          bpmMax: 180           // ✅ Realistic range
        },
        preprocessing: { 
          removeBaselineWander: true,   // ✅ Clean signal
          smoothingWindowMs: 60         // ✅ Conservative smoothing ≈60ms
        },
        quality: {
          cleanRR: false,        // ✅ CRITICAL: RAW RR processing for JS-side correction
          cleanMethod: 'none'    // ✅ CRITICAL: No C++ RR cleaning, JS handles it
        }
      };
    }
  }, []);
  
  const logHeavy = useCallback((tag: string, obj: any) => {
    if (!DEBUG_HEAVY) return;
    heavyLogCountRef.current++;
    if (heavyLogCountRef.current % HEAVY_LOG_THROTTLE === 1) {
      console.log(tag, JSON.stringify(obj, (key, value) => {
        if (Array.isArray(value) && value.length > 10) {
          return `[Array(${value.length})]`;
        }
        return value;
      }, 2));
    }
  }, []);

  // ✅ PHASE 1: Telemetry Functions
  const logTelemetryEvent = useCallback((eventName: string, data: Record<string, any>) => {
    const timestamp = new Date().toISOString();
    console.log(`📊 TELEMETRY [${timestamp}] ${eventName}:`, JSON.stringify(data, null, 2));
    
    // TODO: Send to analytics service in production
    // Analytics.track(eventName, { ...data, timestamp, deviceId, appVersion });
  }, []);

  const logFSMTransition = useCallback((fromState: string, toState: string, reason: string) => {
    logTelemetryEvent('ppg_fsm_transition', {
      fromState,
      toState,
      reason,
      sessionDuration: sessionStartRef.current ? Date.now() - sessionStartRef.current : 0,
      torchDuty: torchTotalDutyRef.current
    });
  }, [logTelemetryEvent]);

  // ✅ P1 FIX: Stop outcome classification for better analytics
  const classifyOutcome = useCallback((reason: string): 'success' | 'error' | 'cancelled' => {
    switch (reason) {
      case 'stall_watchdog':
      case 'poll_error':
      case 'push_error':
        return 'error';
      case 'app_background':
      case 'manual':
      case 'no_signal_timeout':
      case 'early_stop_warmup':
        return 'cancelled';
      default:
        return 'success';
    }
  }, []);

  const logSessionOutcome = useCallback((outcome: 'success' | 'error' | 'cancelled', reason: string, metrics?: any) => {
    const sessionDuration = sessionStartRef.current ? Date.now() - sessionStartRef.current : 0;
    logTelemetryEvent('ppg_session_outcome', {
      outcome,
      reason,
      sessionDuration,
      torchDutyTotal: torchTotalDutyRef.current,
      metrics: metrics || null
    });
  }, [logTelemetryEvent]);

  // ✅ PHASE 1.4: Unified Confidence Score Calculator
  const [useUnifiedConfidence, setUseUnifiedConfidence] = useState(true); // ✅ Start enabled for testing
  
  // ✅ P1 FIX: EMA smoothing for stable confidence
  const prevFinalConfidenceRef = useRef<number>(0);
  const lastConfidenceMethodRef = useRef<string>('base_fallback');
  const methodHoldoffUntilRef = useRef<number>(0);
  
  const calculateUnifiedConfidence = useCallback((qualityMetrics: any): number => {
    if (!qualityMetrics) return prevFinalConfidenceRef.current * 0.9; // ✅ P1 FIX: Decay if no data
    
    const now = Date.now();
    const EMA_ALPHA = 0.7; // 70% history, 30% current
    const METHOD_HOLDOFF_MS = 2000; // Hold method for 2s to prevent flicker
    
    // Extract AVAILABLE metrics from C++ interface
    const snrDb = typeof qualityMetrics.snrDb === 'number' ? qualityMetrics.snrDb : 0;
    const f0Hz = typeof qualityMetrics.f0Hz === 'number' ? qualityMetrics.f0Hz : 0;
    const maPercActive = typeof qualityMetrics.maPercActive === 'number' ? qualityMetrics.maPercActive : 0;
    const pHalfOverFund = typeof qualityMetrics.pHalfOverFund === 'number' ? qualityMetrics.pHalfOverFund : 0;
    const baseConfidence = typeof qualityMetrics.confidence === 'number' ? qualityMetrics.confidence : 0;
    
    // Normalization functions
    const normalize = (value: number, min: number, max: number): number => {
      return Math.max(0, Math.min(1, (value - min) / (max - min)));
    };
    
    // ✅ P1 FIX: Graceful degrade - Use available components with re-weighted formula
    const components = [];
    if (snrDb > 0) components.push({ weight: 0.4, value: normalize(snrDb, 0, 12), name: 'snr' });
    if (f0Hz > 0) components.push({ weight: 0.3, value: normalize(f0Hz, 0.5, 3.0), name: 'f0' });
    if (maPercActive > 0) components.push({ weight: 0.2, value: normalize(maPercActive, 0, 100), name: 'ma' });
    if (pHalfOverFund > 0) components.push({ weight: 0.1, value: Math.max(0, Math.min(1, pHalfOverFund)), name: 'phalf' });
    
    let instantScore = 0;
    let currentMethod = 'base_fallback';
    
    if (components.length >= 2) {
      // ✅ Graceful unified: Re-normalize weights for available components
      const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
      instantScore = components.reduce((sum, c) => sum + (c.weight / totalWeight) * c.value, 0);
      currentMethod = components.length >= 3 ? 'full_unified_cpp' : 'partial_unified_cpp';
    } else if (components.length === 1) {
      // ✅ Single component available (usually SNR)
      instantScore = (components[0].value * 0.7) + (baseConfidence * 0.3);
      currentMethod = 'snr_base_hybrid';
    } else {
      // ✅ Pure fallback: Only base confidence
      instantScore = Math.max(0, Math.min(1, baseConfidence));
      currentMethod = 'base_fallback';
    }
    
    // ✅ P1 FIX: Method stability - Hold method for 2s to prevent flicker
    const canChangeMethod = now >= methodHoldoffUntilRef.current;
    const finalMethod = canChangeMethod ? currentMethod : lastConfidenceMethodRef.current;
    
    if (canChangeMethod && currentMethod !== lastConfidenceMethodRef.current) {
      lastConfidenceMethodRef.current = currentMethod;
      methodHoldoffUntilRef.current = now + METHOD_HOLDOFF_MS;
    }
    
    // ✅ P1 FIX: EMA temporal smoothing - prevent confidence flicker
    const smoothedScore = EMA_ALPHA * prevFinalConfidenceRef.current + (1 - EMA_ALPHA) * instantScore;
    const finalScore = Math.max(0, Math.min(1, smoothedScore));
    
    // ✅ Save smoothed result for next iteration
    prevFinalConfidenceRef.current = finalScore;
    
    // ✅ Throttled telemetry (every 10th call to avoid spam)
    unifiedConfCallCountRef.current++;
    
    if (unifiedConfCallCountRef.current % 10 === 1) {
      logTelemetryEvent('unified_confidence_debug', {
        // ✅ Available C++ metrics
        snrDb, snrNorm: normalize(snrDb, 0, 12),
        f0Hz, f0Norm: normalize(f0Hz, 0.5, 3.0),
        maPercActive, maPercNorm: normalize(maPercActive, 0, 100),
        pHalfOverFund, pHalfNorm: Math.max(0, Math.min(1, pHalfOverFund)),
        baseConfidence,
        instantScore,
        finalScore,
        componentsAvailable: components.length,
        hasFullComponents: components.length >= 3,
        hasPartialComponents: components.length >= 1,
        method: finalMethod,
        emaAlpha: EMA_ALPHA,
        methodStable: finalMethod === currentMethod
      });
    }
    
    return finalScore;
  }, [logTelemetryEvent]);

  const getEffectiveConfidence = useCallback((qualityMetrics: any): number => {
    if (useUnifiedConfidence) {
      return calculateUnifiedConfidence(qualityMetrics);
    }
    return Math.max(0, Math.min(1, qualityMetrics?.confidence ?? 0));
  }, [useUnifiedConfidence, calculateUnifiedConfidence]);

  // ✅ PHASE 2: Enhanced Multi-ROI Quality Analysis  
  const analyzeSignalQuality = useCallback((qualityMetrics: any) => {
    if (!qualityMetrics) return;
    
    const now = Date.now();
    const confidence = getEffectiveConfidence(qualityMetrics);
    const snr = qualityMetrics.snrDb || 0;
    const f0Hz = qualityMetrics.f0Hz || 0;
    const maPerc = qualityMetrics.maPercActive || 0;
    
    // ✅ Enhanced grid quality estimate using available C++ metrics
    const gridQuality = Math.min(1, (
      confidence + 
      Math.min(1, snr / 10) + 
      Math.min(1, f0Hz / 3.0) + 
      Math.min(1, maPerc / 100)
    ) / 4);
    
    // ✅ P1 FIX: Correct telemetry mapping - acDc should use acDcRatio, not f0Hz
    const acDc = qualityMetrics?.acDcRatio ?? 0; // ✅ CORRECT field mapping
    const qualityEntry = { timestamp: now, confidence, snr, acDc, gridQuality };
    signalQualityHistoryRef.current.push(qualityEntry);
    
    // Keep only last 10 entries
    if (signalQualityHistoryRef.current.length > 10) {
      signalQualityHistoryRef.current.shift();
    }
    
    logTelemetryEvent('signal_quality_analysis', qualityEntry);
    
    return gridQuality;
  }, [getEffectiveConfidence, logTelemetryEvent]);

  // ✅ PHASE 2: Adaptive ROI Management
  const adjustROIIfNeeded = useCallback(() => {
    const now = Date.now();
    if (now - lastROIAdjustment < 3000) return; // Max once per 3s
    
    const history = signalQualityHistoryRef.current;
    if (history.length < 5) return;
    
    // Calculate recent signal quality trend
    const recentQualities = history.slice(-5).map(h => h.gridQuality);
    const avgQuality = recentQualities.reduce((a, b) => a + b, 0) / recentQualities.length;
    const qualityTrend = recentQualities[recentQualities.length - 1] - recentQualities[0];
    
    // Adaptive ROI sizing based on quality
    let newROI = roi;
    if (avgQuality < 0.3 && qualityTrend < -0.1) {
      // Quality dropping - try larger ROI
      newROI = Math.min(0.6, roi + 0.05);
    } else if (avgQuality > 0.7 && qualityTrend > 0.1) {
      // Quality good and improving - optimize ROI size
      newROI = Math.max(0.3, roi - 0.02);
    }
    
    if (Math.abs(newROI - roi) > 0.01) {
      setRoi(newROI);
      setLastROIAdjustment(now);
      logTelemetryEvent('adaptive_roi_adjustment', {
        oldROI: roi,
        newROI,
        avgQuality,
        qualityTrend,
        reason: avgQuality < 0.3 ? 'quality_drop' : 'quality_optimization'
      });
      console.log(`🎯 Adaptive ROI: ${roi.toFixed(2)} → ${newROI.toFixed(2)} (quality: ${avgQuality.toFixed(2)}, trend: ${qualityTrend.toFixed(2)})`);
    }
  }, [roi, lastROIAdjustment, logTelemetryEvent]);

  // ✅ PHASE 2: Advanced RR Artifact Correction (Kubios-inspired)
  const correctRRIntervals = useCallback((rrIntervals: number[]): {
    correctedRR: number[],
    outlierCount: number,
    correctionRatio: number,
    method: string
  } => {
    if (!rrIntervals || rrIntervals.length < 3) {
      return { correctedRR: rrIntervals || [], outlierCount: 0, correctionRatio: 0, method: 'none' };
    }
    
    // MAD-based outlier detection (robust to skewed distributions)
    const computeMedian = (arr: number[]): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    
    const computeMAD = (arr: number[], median: number): number => {
      const deviations = arr.map(x => Math.abs(x - median));
      return computeMedian(deviations);
    };
    
    const median = computeMedian(rrIntervals);
    const mad = computeMAD(rrIntervals, median);
    const threshold = 3.0 * mad; // 3-MAD threshold (conservative)
    
    const correctedRR: number[] = [];
    let outlierCount = 0;
    
    for (let i = 0; i < rrIntervals.length; i++) {
      const rr = rrIntervals[i];
      const deviation = Math.abs(rr - median);
      
      if (deviation > threshold) {
        // Outlier detected - apply correction
        outlierCount++;
        
        if (i === 0 || i === rrIntervals.length - 1) {
          // Edge outliers - use median
          correctedRR.push(median);
        } else {
          // Internal outliers - cubic spline interpolation (simplified)
          const prev = rrIntervals[i - 1];
          const next = rrIntervals[i + 1];
          const interpolated = (prev + next) / 2; // Linear for simplicity
          correctedRR.push(interpolated);
        }
      } else {
        correctedRR.push(rr);
      }
    }
    
    const correctionRatio = rrIntervals.length > 0 ? outlierCount / rrIntervals.length : 0;
    
    logTelemetryEvent('rr_artifact_correction', {
      originalCount: rrIntervals.length,
      outlierCount,
      correctionRatio,
      median,
      mad,
      threshold,
      method: 'mad_spline'
    });
    
    return {
      correctedRR,
      outlierCount,
      correctionRatio,
      method: 'mad_spline'
    };
  }, [logTelemetryEvent]);

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

  // ✅ CRITICAL: Removed unused triggerHapticForBeat function (code cleanup)

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
            
            // ✅ P1 FIX: Fallback ingest when native producer stalls
            if (enableFallback && v != null && typeof v === 'number' && isFinite(v)) {
              runOnJS(ingestSample)(v);
            }
            
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
  }, [useNativePPG, roi, ppgPlugin, ppgChannel, ppgMode, ppgGrid, autoSelect, torchOn, enableFallback, ingestSample]);

  // Native module polling for real PPG data + timestamps + plugin confidence
  // ✅ P0 FIX: Universal Array/TypedArray → number[] converter  
  const toNumArray = useCallback((maybe: any): number[] => {
    if (!maybe) return [];
    // Regular Array
    if (Array.isArray(maybe)) {
      return maybe.map(Number).filter(isFinite);
    }
    // TypedArray (Float32Array, Float64Array, etc.)
    if (ArrayBuffer.isView(maybe) && typeof maybe.length === 'number') {
      return Array.from(maybe as ArrayLike<number>).map(Number).filter(isFinite);
    }
    return [];
  }, []);

  // ✅ P0 FIX: Fallback ingest MUST be defined BEFORE useFrameProcessor 
  const ingestSample = useCallback((val: number) => {
    const v = Number(val);
    if (!isFinite(v)) return;
    
    frameBufferRef.current.push(v);
    if (frameBufferRef.current.length > bufferSize) frameBufferRef.current.shift();
    pendingSamplesRef.current.push(v);
    if (pendingSamplesRef.current.length > bufferSize) {
      pendingSamplesRef.current.splice(0, pendingSamplesRef.current.length - bufferSize);
    }
    lastSampleAtRef.current = Date.now();
  }, [bufferSize]);

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
          
          // ✅ DEBUG: Always log plugin confidence for troubleshooting
          if (confVal !== lastLoggedConfRef.current) {
            console.log(`📊 Plugin Confidence: ${confVal.toFixed(4)} (${confVal >= CFG.CONF_HIGH ? 'HIGH' : confVal >= CFG.CONF_LOW ? 'MID' : 'LOW'})`);
            lastLoggedConfRef.current = confVal;
          }
        } else {
          console.log('📊 Plugin Confidence: NULL or invalid');
        }
        let latestSamples: number[] = [];
        let latestTs: number[] | null = null;
        
        // ✅ P0 FIX: Handle both Array and TypedArray from native  
        if (pack && Array.isArray(pack)) {
          // Old format: direct array
          latestSamples = toNumArray((pack as any).slice(-20));
        } else if (pack && typeof pack === 'object') {
          // New format: {samples, timestamps} - could be Arrays or TypedArrays
          const xs = toNumArray((pack as any).samples);  
          const ts = toNumArray((pack as any).timestamps);
          const k = Math.min(xs.length, ts.length);
          if (k > 0) {
            latestSamples = xs.slice(-k);
            latestTs = ts.slice(-k);
          }
          
          // ✅ DEBUG: Log pack structure for diagnosis when samples empty
          if (xs.length === 0 && (pack as any).samples) {
            console.log('🔍 PACK DEBUG:', {
              packType: typeof pack,
              samplesType: typeof (pack as any).samples,
              isArray: Array.isArray((pack as any).samples),
              isTypedArray: ArrayBuffer.isView((pack as any).samples),
              length: (pack as any).samples?.length ?? 'no length',
              constructor: (pack as any).samples?.constructor?.name ?? 'no constructor'
            });
          }
        }
        
        // ✅ P1 FIX: Producer watchdog - activate fallback if native producer stalls
        const now = Date.now();
        const noProducer = (now - lastSampleAtRef.current) > FALLBACK_AFTER_MS;
        const shouldEnableFallback = noProducer && isAnalyzingRef.current;
        
        if (shouldEnableFallback !== enableFallback) {
          setEnableFallback(shouldEnableFallback);
          if (shouldEnableFallback) {
            console.log('⚠️ Producer watchdog: Native producer stalled, fallback ingest enabled');
            logTelemetryEvent('producer_watchdog', { 
              stallDuration: now - lastSampleAtRef.current,
              fallbackEnabled: true 
            });
          } else {
            console.log('✅ Producer watchdog: Native producer resumed, fallback ingest disabled');
            logTelemetryEvent('producer_watchdog', { 
              stallDuration: 0,
              fallbackEnabled: false 
            });
          }
        }
        
        // ✅ Update sample timestamp when we get data from native
        if (latestSamples.length > 0) {
          lastSampleAtRef.current = now;
        }
        
        // ✅ P1 FIX: No-signal early stop - check for complete pipeline stall
        if (isAnalyzingRef.current && (fsmRef.current === 'starting' || fsmRef.current === 'running')) {
          const hasSignal = latestSamples.length > 0 || pendingSamplesRef.current.length > 0;
          const hasData = confVal > 0 || hasSignal;
          
          if (hasData) {
            // Reset timer when we have any kind of signal/data
            lastSignalCheckRef.current = now;
          } else {
            // Check for timeout
            const noSignalDuration = now - lastSignalCheckRef.current;
            if (noSignalDuration > NO_SIGNAL_TIMEOUT_MS) {
              console.log(`⚠️ No-signal early stop: ${noSignalDuration}ms without data (samples: ${latestSamples.length}, pending: ${pendingSamplesRef.current.length}, conf: ${confVal})`);
              logTelemetryEvent('no_signal_early_stop', { 
                duration: noSignalDuration,
                fsmState: fsmRef.current,
                sampleCount: latestSamples.length,
                pendingCount: pendingSamplesRef.current.length,
                confidence: confVal
              });
              
              // Stop FSM due to no signal
              stopAnalysisFSM('no_signal_timeout').catch(() => {
                console.error('Failed to stop FSM on no-signal timeout');
              });
              return; // Exit polling loop
            }
          }
        } else {
          // Reset timer when not analyzing
          lastSignalCheckRef.current = now;
        }
        
  // ✅ DEBUG: Auto-start logic with plugin confidence monitoring
  if (confVal > 0) {
    console.log(`🔍 Plugin Conf: ${confVal.toFixed(3)} (threshold: ${CFG.CONF_HIGH}) - Cover: ${coverStableMsRef.current}ms`);
  }
  
  // ✅ Force start when frameBuffer full and plugin confidence is 0
  if (frameBufferRef.current.length >= 400 && fsmRef.current === 'idle' && !isAnalyzing) {
    const timeSinceLastStart = Date.now() - lastAutoToggleAtRef.current;
    if (timeSinceLastStart > 5000) { // 5s cooldown
      console.log('🚀 FORCE START: frameBuffer full + plugin conf low/0, manual trigger for analysis');
      console.log(`   📊 Plugin conf: ${confVal.toFixed(4)}, frameBuffer: ${frameBufferRef.current.length}`);
      startAnalysisFSM().catch((e) => console.error('Force start failed:', e));
    }
  }
  
  // ✅ CRITICAL: Plugin confidence ONLY for auto-start trigger, NOT for auto-stop
  // ✅ CRITICAL: Split timers - plugin confidence timing separate from C++ quality
  const nowTs = Date.now();
  const pluginDt = lastPluginPollTsRef.current ? Math.max(1, nowTs - lastPluginPollTsRef.current) : 200;
  lastPluginPollTsRef.current = nowTs;
  
  // ✅ Only track plugin confidence for START trigger (not STOP)
  if (confVal >= CFG.CONF_HIGH) {
    coverStableMsRef.current += pluginDt;
    uncoverStableMsRef.current = 0;
  } else if (confVal <= CFG.CONF_LOW) {
    uncoverStableMsRef.current += pluginDt;
    coverStableMsRef.current = 0;
  } else {
    // Middle zone - slow decay
    coverStableMsRef.current = Math.max(0, coverStableMsRef.current - pluginDt/2);
    uncoverStableMsRef.current = Math.max(0, uncoverStableMsRef.current - pluginDt/2);
  }
  
  // Auto-start triggering based on plugin confidence (START only!)
  const coolOK = Date.now() - lastAutoToggleAtRef.current >= CFG.COOLDOWN_MS;
  
  // START: high confidence + debounce + cooldown
  if (!isAnalyzingRef.current && coverStableMsRef.current >= CFG.HIGH_DEBOUNCE_MS && coolOK) {
    console.log(`🟢 Auto-start triggered: conf=${confVal.toFixed(3)}, coverMs=${coverStableMsRef.current}, coolOK=${coolOK}`);
    await startAnalysisFSM();
  }
  
  // ✅ STOP decisions moved entirely to C++ quality processing (below in performRealtimeAnalysis)
        // ✅ GATE kaldırıldı - etkisizdi (latestSamples.length > 0 varsa her zaman true)
        if (latestSamples.length > 0) {
          // ✅ Watchdog: Data received, update timestamp
          lastDataAtRef.current = Date.now();
          
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
            if (latestTs && latestTs.length === latestSamples.length && analyzerRef.current?.pushWithTimestamps) {
              const xs = new Float32Array(latestSamples);
              const ts = new Float64Array(latestTs);
              await analyzerRef.current.pushWithTimestamps(xs, ts);
              // ✅ ÖNEMLİ: pendingSamplesRef'i temizle çünkü data push edildi!
              pendingSamplesRef.current = [];
            }
          } catch (e) {
            console.warn('pushWithTimestamps failed, will use regular push:', e);
            // ✅ Bu normal - rtPushTs mevcut değilse regular push kullanır
            // Hata durumunda pendingSamplesRef dolu kalır, normal push kullanılır
          }
        }
        // Otomatik başlat/durdur: süre-bazlı histerezis + cooldown + min-run
        try {
          const now = Date.now();
          const ranMs = now - (analyzeStartTsRef.current || 0);
          const coolOK = now - (lastAutoToggleAtRef.current || 0) >= CFG.COOLDOWN_MS;
          // ✅ CRITICAL: Removed duplicate auto-start/stop logic  
          // All FSM decisions now happen in performRealtimeAnalysis with C++ quality
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
      
      // ✅ CRITICAL: Pretorch improvement - accumulate but don't push until stable
      const now = Date.now();
      const inPretorch = now < pretorchUntilRef.current;
      
      if (inPretorch) {
        console.log(`⏳ Pretorch period: Accumulating ${pending.length} samples (${pretorchUntilRef.current - now}ms remaining)`);
        // ✅ DON'T clear pending - let them accumulate for better batch push
        return; // Skip C++ analysis during ramp-up but keep samples
      }
      
      // ✅ Post-pretorch: Enhanced batch push with telemetry
      if (pending.length > 60) { // Large batch after pretorch
        console.log(`📦 Post-pretorch batch: Pushing ${pending.length} accumulated samples`);
        logTelemetryEvent('pretorch_batch_size', {
          batchSize: pending.length,
          pretorchDuration: PRETORCH_DROP_MS,
          timestamp: now
        });
      }
      
      console.log(`📥 Pushing ${pending.length} samples to C++ analyzer`);
      
      // ✅ DEBUG: Sample değerlerini kontrol et
      if (pending.length > 0) {
        const sampleStats = {
          min: Math.min(...pending),
          max: Math.max(...pending),
          mean: pending.reduce((a, b) => a + b, 0) / pending.length,
          first5: pending.slice(0, 5),
          last5: pending.slice(-5)
        };
        console.log('📊 SAMPLE STATS:', sampleStats);
      }
      
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
        
        // ✅ CRITICAL: Heavy log throttling - default OFF for production performance
        logHeavy('🔥 NATIVE C++ ANALYZER RESULT:', {
          'C++ BPM': result.bpm,
          'RR Count': Array.isArray(result.rrList) ? result.rrList.length : 0,
          'Peak Count': Array.isArray(result.peakList) ? result.peakList.length : 0,
          'C++ Confidence': (result as any).quality?.confidence,
          'C++ SNR': (result as any).quality?.snrDb,
          'Total Beats': (result as any).quality?.totalBeats,
          'Result Type': typeof result.bpm,
          'Is Finite': isFinite(result.bpm || 0)
        });
        
        // ✅ P1 FIX: Throttled heavy logging - performance optimization
        if ((result as any).quality) {
          logHeavy('📊 DETAILED QUALITY:', (result as any).quality);
        }
        
        logHeavy('📋 FULL RESULT:', result);
        
        try {
          // C++ NATIVE BPM'İNİ AYNEN KULLAN - HİÇ DEĞİŞTİRME!
          const calculatedBpm = typeof result.bpm === 'number' ? result.bpm : 0;
          
          console.log(`🎯 C++ Native BPM (değiştirilmeden): ${calculatedBpm.toFixed(1)}`);
          
          const newMetrics: any = result;
          
          // C++ BPM AYNEN KULLANILIYOR - HİÇ DEĞİŞİKLİK YOK
          console.log(`✅ UI'da gösterilecek BPM: ${calculatedBpm.toFixed(1)} (C++ orijinal değeri)`);
          
          // ✅ PHASE 2: Enhanced signal quality analysis
          const gridQuality = analyzeSignalQuality((newMetrics as any)?.quality);
          
          // ✅ PHASE 2: Adaptive ROI adjustment (if enabled)
          if (adaptiveROI && fsmRef.current === 'running') {
            adjustROIIfNeeded();
          }
          
          // ✅ P0 FIX: RR Artifact Correction - use top-level rrList from C++ result
          const rrListTop = Array.isArray((newMetrics as any)?.rrList) ? (newMetrics as any).rrList : null;
          if (rrCorrectionEnabled && rrListTop && rrListTop.length > 2) {
            const originalRR = rrListTop;
            const correction = correctRRIntervals(originalRR);
            
            // Store corrected RR back to metrics for UI display
            (newMetrics as any).quality.correctedRRList = correction.correctedRR;
            (newMetrics as any).quality.rrOutlierCount = correction.outlierCount;
            (newMetrics as any).quality.rrCorrectionRatio = correction.correctionRatio;
            (newMetrics as any).quality.rrCorrectionMethod = correction.method;
            
            setLastRRCorrection({
              outlierCount: correction.outlierCount,
              correctionRatio: correction.correctionRatio,
              method: correction.method
            });
            
            if (correction.outlierCount > 0) {
              console.log(`🔧 RR Correction: ${correction.outlierCount}/${originalRR.length} outliers (${(correction.correctionRatio * 100).toFixed(1)}%)`);
            }
          }
          
          // ✅ P2 FIX: HRV Quality Gate - validate metrics before display
          const qualityMetrics = (newMetrics as any)?.quality;
          if (qualityMetrics) {
            const snr = qualityMetrics.snrDb ?? 0;
            const confidence = qualityMetrics.confidence ?? 0;
            const rejectionRate = qualityMetrics.rejectionRate ?? 0;
            const pHalfOverFund = qualityMetrics.pHalfOverFund ?? 0;
            const rrCount = Array.isArray(qualityMetrics.rrList) ? qualityMetrics.rrList.length : 0;
            
            // ✅ CRITICAL: HRV quality criteria using consistent cppSnr naming
            const hrvQualityGate = (
              cppSnr > 5 &&                    // ✅ C++ SNR > 5 dB 
              (confidence > 0.3 || cppSnr > 6) && // ✅ Confidence > 0.3 OR good C++ SNR
              rejectionRate < 0.3 &&        // ✅ Rejection rate < 30% (gevşetildi)
              pHalfOverFund < 0.5 &&        // ✅ Less strict doubling check
              rrCount >= 15                 // ✅ At least 15 RR intervals (gevşetildi)
            );
            
            // ✅ P2 FIX: Mask invalid HRV metrics
            if (!hrvQualityGate) {
              console.log(`⚠️ HRV quality gate FAILED - masking HRV metrics (C++ SNR: ${cppSnr.toFixed(1)}, Conf: ${confidence.toFixed(2)}, RejRate: ${rejectionRate.toFixed(2)}, RR count: ${rrCount})`);
              
              // Mask HRV metrics when quality is insufficient
              (newMetrics as any).rmssd = null;
              (newMetrics as any).sdnn = null;
              (newMetrics as any).pnn50 = null;
              (newMetrics as any).pnn20 = null;
              (newMetrics as any).nn50 = null;
              (newMetrics as any).nn20 = null;
              (newMetrics as any).sd1 = null;
              (newMetrics as any).sd2 = null;
              (newMetrics as any).lf = null;
              (newMetrics as any).hf = null;
              (newMetrics as any).lfhf = null;
              
              // Add quality warning
              if (qualityMetrics.qualityWarning) {
                qualityMetrics.qualityWarning += ' | HRV metrics masked due to insufficient quality';
              } else {
                qualityMetrics.qualityWarning = 'HRV metrics masked due to insufficient quality';
              }
            } else {
            console.log(`✅ HRV quality gate PASSED - metrics reliable`);
          }
        }
        
        // ✅ CRITICAL: C++ quality gate using separate timing and consistent naming
        const cppConf = qualityMetrics?.confidence ?? 0;
        const cppGoodQuality = qualityMetrics?.goodQuality ?? false;
        const cppSnr = qualityMetrics?.snrDb ?? 0;  // ✅ Consistent cppSnr naming
        const now = Date.now();
        const cppDt = lastCppPollTsRef.current ? Math.max(1, now - lastCppPollTsRef.current) : 200;
        lastCppPollTsRef.current = now;
        
        // ✅ CRITICAL: Update stability counters using C++ timing and consistent naming
        if (cppGoodQuality && (cppConf >= 0.3 || cppSnr > 6)) {
          coverStableMsRef.current += cppDt;
          uncoverStableMsRef.current = 0;
        } else if (!cppGoodQuality || cppConf <= 0.1) {
          uncoverStableMsRef.current += cppDt;
          coverStableMsRef.current = 0;
        } else {
          // Middle zone - slow decay
          coverStableMsRef.current = Math.max(0, coverStableMsRef.current - cppDt/2);
          uncoverStableMsRef.current = Math.max(0, uncoverStableMsRef.current - cppDt/2);
        }
        
        setMetrics(newMetrics as PPGMetrics);
          
        // C++ analizindeki beat artışına göre haptic feedback (kalite koşulu ile)
        const currentBeatCount = (newMetrics as any).quality?.totalBeats ?? 0;
        // cppConf already declared above
        // ✅ P1 FIX: Haptic gate - C++ confidence (ground truth), not unified
        if (currentBeatCount > lastBeatCount && fsmRef.current === 'running' && cppGoodQuality && cppConf >= 0.05) {
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
        
        // ✅ P1 FIX: Auto-stop logic using C++ quality after minimum run time
        const ranMs = Date.now() - analyzeStartTsRef.current;
        const coolOK = Date.now() - lastAutoToggleAtRef.current >= CFG.COOLDOWN_MS;
        
        // ✅ CRITICAL: Single STOP gate using only C++ quality with telemetry
        if (fsmRef.current === 'running' && 
            ranMs >= CFG.MIN_RUN_MS && 
            coolOK && 
            uncoverStableMsRef.current >= CFG.LOW_DEBOUNCE_MS &&
            (!cppGoodQuality || cppConf <= 0.1)) {
          
          console.log(`🔴 Auto-stop: Poor C++ quality (goodQ: ${cppGoodQuality}, conf: ${cppConf.toFixed(3)}, uncoverMs: ${uncoverStableMsRef.current})`);
          
          // ✅ CRITICAL: Quality gate telemetry for monitoring
          logTelemetryEvent('quality_gates', {
            triggerType: 'cpp_quality_drop',
            cppGoodQuality,
            cppConfidence: cppConf,
            cppSnr: cppSnr,
            uncoverDuration: uncoverStableMsRef.current,
            sessionDuration: ranMs,
            reason: 'poor_cpp_quality_sustained'
          });
          
          await stopAnalysisFSM('cpp_quality_drop');
          return;
        }
          
          // Status mesajını güncelle + FSM warmup transition
          const nowTs = Date.now();
          const inWarmup = nowTs < (warmupUntilRef.current || 0);
          
          // ✅ CRITICAL: Warmup completion using C++ quality (ground truth), not unified
          if (!inWarmup && fsmRef.current === 'starting') {
            const cppConf = (newMetrics as any)?.quality?.confidence ?? 0;
            const cppGoodQuality = (newMetrics as any)?.quality?.goodQuality ?? false;
            const cppSnr = (newMetrics as any)?.quality?.snrDb ?? 0;
            const bpmNow = newMetrics.bpm ?? 0;
            const peaksNow = (newMetrics as any)?.quality?.totalBeats ?? 0;
            console.log(`🟡 Warmup complete - C++ Conf: ${cppConf.toFixed(3)}, GoodQ: ${cppGoodQuality}, SNR: ${cppSnr.toFixed(1)}, BPM: ${bpmNow.toFixed(1)}, Peaks: ${peaksNow}`);
            
            // ✅ CRITICAL: C++ quality-based warmup validation using consistent cppSnr
            const hasValidData = (cppGoodQuality && cppConf >= 0.3) || (cppSnr > 5 && peaksNow > 3) || (bpmNow > 40 && bpmNow < 180 && peaksNow > 5);
            
            if (hasValidData) {
              console.log('🟡 Warmup OK → running (C++ quality validated)');
              fsmRef.current = 'running';
            } else {
              console.log(`🔴 Warmup failed - C++ Conf: ${cppConf.toFixed(3)}, GoodQ: ${cppGoodQuality}, SNR: ${cppSnr.toFixed(1)} → extending warmup`);
              // ✅ Warmup'ı uzat, hemen durdurmak yerine
              warmupUntilRef.current = Date.now() + 2000; // 2s ek süre
              
              // ✅ iOS-only: Torch boost when warmup extends and fallback is active
              if (Platform.OS === 'ios' && enableFallback && cameraLockEnabled && NativeModules.PPGCameraManager?.setTorchLevel) {
                const nextIdx = Math.min(currentTorchLevelIndex + 1, torchLevels.length - 1);
                if (nextIdx !== currentTorchLevelIndex) {
                  setCurrentTorchLevelIndex(nextIdx);
                  setTorchLevel(torchLevels[nextIdx]);
                  
                  NativeModules.PPGCameraManager.setTorchLevel(torchLevels[nextIdx]).then(() => {
                    console.log(`🔥 iOS Torch boost on warmup extend: ${torchLevels[nextIdx]}`);
                    logTelemetryEvent('torch_boost_on_warmup_extend', { 
                      platform: 'ios',
                      oldLevel: torchLevels[currentTorchLevelIndex],
                      newLevel: torchLevels[nextIdx],
                      fallbackActive: enableFallback 
                    });
                  }).catch((e) => {
                    console.warn('iOS Torch boost failed:', e);
                  });
                }
              }
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
    
    // ✅ FSM tek kapı - tüm start/stop FSM üzerinden
    if (fsmRef.current !== 'idle') {
      // Tek kapıdan durdur
      await stopAnalysisFSM('manual');
            return;
    }
    
    // Tek kapıdan başlat  
    await startAnalysisFSM();
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

  // ✅ PHASE 1: AppState listener - background handling + torch guarantee
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState !== 'active' && isAnalyzingRef.current) {
        console.log('⚠️ App going to background - stopping analysis for safety');
        stopAnalysisFSM('app_background').catch(() => {
          console.error('Failed to stop analysis on background');
        });
      } else if (nextAppState === 'active' && isAnalyzingRef.current) {
        // ✅ P1 FIX: Re-prime torch and camera locks on foreground return
        console.log('✅ App returning to foreground - re-priming torch and camera');
        
        try {
          // ✅ iOS-only: Re-apply camera locks on foreground
          if (Platform.OS === 'ios') {
            await lockCameraSettings();
          }
          
          // Guarantee torch is ON
          if (device?.hasTorch && torchOn) {
            setTorchOn(true); // Re-trigger
            
            // ✅ iOS-only: Torch guarantee via PPGCameraManager
            if (Platform.OS === 'ios' && cameraLockEnabled && NativeModules.PPGCameraManager?.setTorchLevel) {
              await NativeModules.PPGCameraManager.setTorchLevel(torchLevel);
              console.log(`🔦 iOS Torch RE-GUARANTEED ON after foreground - level: ${torchLevel}`);
            } else {
              console.log('🔦 Torch re-enabled (VisionCamera managed)');
            }
            
            logTelemetryEvent('torch_foreground_guarantee', { 
              torchOn: true, 
              level: torchLevel 
            });
          }
        } catch (e) {
          console.warn('Foreground torch/camera re-prime failed:', e);
        }
      }
    });

    return () => subscription?.remove();
  }, [stopAnalysisFSM, lockCameraSettings, device, torchOn, torchLevel, cameraLockEnabled, logTelemetryEvent]);

  // ✅ P1 FIX: Unmount safety - but prevent premature unmount during normal operation
  useEffect(() => {
    return () => {
      // ✅ Only cleanup if component actually unmounting (not just re-rendering)
      const shouldCleanup = fsmRef.current !== 'idle';
      if (shouldCleanup) {
        console.log('🔴 Component ACTUALLY unmounting - forcing clean stop');
        console.log(`   📊 FSM State: ${fsmRef.current}, Analyzing: ${isAnalyzingRef.current}`);
        
        // Add delay to distinguish from re-render
        setTimeout(() => {
          if (fsmRef.current !== 'idle') {
            stopAnalysisFSM('unmount').catch(() => {
              console.error('Failed to stop FSM on unmount');
            });
          }
        }, 100); // 100ms delay to avoid re-render conflicts
      }
    };
  }, []); // ✅ Empty deps to prevent re-running on every state change

  // ✅ PHASE 1: Watchdog timer - stall detection
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      if (isAnalyzingRef.current) {
        const timeSinceLastData = Date.now() - lastDataAtRef.current;
        if (timeSinceLastData > 5000) { // 5 seconds stall
          console.warn('⛑️ PPG data stall detected - stopping analysis');
          console.warn(`⛑️ Time since last data: ${timeSinceLastData}ms`);
          stopAnalysisFSM('stall_watchdog').catch(() => {
            console.error('Failed to stop analysis on stall');
          });
        }
      }
    }, 1000); // Check every second

    return () => clearInterval(watchdogInterval);
  }, [stopAnalysisFSM]);

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
            frameProcessor={isActive ? frameProcessor : undefined}
            // ✅ P1 FIX: Single camera authority - only Android uses VisionCamera props
            {...(Platform.OS === 'android' ? { fps: targetFps } : {})}
            // ✅ CRITICAL: iOS torch controlled by PPGCameraManager, Android by VisionCamera
            {...(Platform.OS === 'android' 
              ? { torch: device?.hasTorch && torchOn ? 'on' : 'off' }
              : {})} 
            // ✅ CRITICAL: Android prop guard - only use supported VisionCamera props
            {...(Platform.OS === 'android' && cameraLockEnabled && lockExposure && device?.supportsManualExposure ? { 
              exposure: lockExposure 
            } : {})}
            {...(Platform.OS === 'android' && cameraLockEnabled && lockIso && device?.supportsManualISO ? { 
              iso: lockIso 
            } : {})}
            // Note: iOS camera controls handled exclusively by PPGCameraManager
            // Note: iOS camera controls handled by PPGCameraManager.lockCameraSettings()
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
              console.log('🟢 Camera initialized with locked settings');
              console.log('🔐 Camera locks - FPS:', targetFps, 'Exposure:', lockExposure, 'ISO:', lockIso, 'Focus:', lockFocus);
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
          📊 PPG: {useNativePPG ? 'ON' : 'OFF'} • FPS: {targetFps} • Grid: {ppgGrid}x{ppgGrid} • FSM: {fsmRef.current} • 
          Conf: {useUnifiedConfidence ? 'UNI' : 'BASE'} • RR: {rrCorrectionEnabled ? 'COR' : 'RAW'}
        </Text>
        <View style={[styles.qualityPill, { backgroundColor: confColor }]}> 
          <Text numberOfLines={1} style={styles.qualityPillText}>
            {useUnifiedConfidence ? 
              `${Math.round(getEffectiveConfidence(metrics?.quality) * 100)}%ᵁ` : 
              `${Math.round((metrics?.quality?.confidence ?? 0) * 100)}%`}
          </Text>
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
                // ✅ CRITICAL: O(n²) → O(n) optimization - single pass mean + std calculation
                let sum = 0, sumSq = 0;
                for (let i = 0; i < array.length; i++) {
                  const val = array[i];
                  sum += val;
                  sumSq += val * val;
                }
                const mean = sum / array.length;
                const variance = (sumSq / array.length) - (mean * mean);
                const std = Math.sqrt(Math.max(0, variance)); // Ensure non-negative
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
                  <Text style={styles.metricValue}>
                    {useUnifiedConfidence ? 
                      `${String((getEffectiveConfidence(metrics.quality) * 100).toFixed(0))}%ᵁ` :
                      `${String(((metrics.quality?.confidence ?? 0) * 100).toFixed(0))}%`}
                  </Text>
                  <Text style={styles.metricLabel}>
                    {useUnifiedConfidence ? 'Unified Güven' : 'Base Güven'}
                  </Text>
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
              <Text style={styles.detailItem}>
                <Text style={styles.detailKey}>Base Confidence:</Text> {String(((metrics.quality?.confidence ?? 0) * 100).toFixed(0))}%
                    </Text>
              {useUnifiedConfidence && (
                <>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>Unified Confidence:</Text> {String((getEffectiveConfidence(metrics.quality) * 100).toFixed(0))}%
                  </Text>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>f0 Hz:</Text> {String(metrics.quality?.f0Hz?.toFixed?.(2) ?? '—')}
                  </Text>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>MA Active %:</Text> {String(metrics.quality?.maPercActive?.toFixed?.(1) ?? '—')}
                  </Text>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>P Half/Fund:</Text> {String(metrics.quality?.pHalfOverFund?.toFixed?.(3) ?? '—')}
                  </Text>
                </>
              )}
              {rrCorrectionEnabled && metrics.quality?.correctedRRList && (
                <>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>RR Outliers:</Text> {String(metrics.quality?.rrOutlierCount ?? 0)}
                  </Text>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>RR Correction:</Text> {String(((metrics.quality?.rrCorrectionRatio ?? 0) * 100).toFixed(1))}%
                  </Text>
                  <Text style={styles.detailItem}>
                    <Text style={styles.detailKey}>RR Method:</Text> {String(metrics.quality?.rrCorrectionMethod ?? '—')}
                  </Text>
                </>
              )}
              <Text style={styles.detailItem}><Text style={styles.detailKey}>SNR dB:</Text> {String(metrics.quality?.snrDb?.toFixed?.(1) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>f0 Hz:</Text> {String((metrics as any)?.quality?.f0Hz?.toFixed?.(2) ?? '—')}</Text>
              <Text style={styles.detailItem}><Text style={styles.detailKey}>Uyarı:</Text> {String(metrics.quality?.qualityWarning ?? '—')}</Text>
            </View>
          )}

          {metricsTab === 'Ham' && (
            <View>
              {/* Phase 2 Feature Controls */}
              <View style={[styles.grid2col, { marginBottom: 16 }]}>
                <TouchableOpacity 
                  style={[styles.featureButton, adaptiveROI ? styles.featureButtonActive : styles.featureButtonInactive]}
                  onPress={() => {
                    setAdaptiveROI(!adaptiveROI);
                    logTelemetryEvent('adaptive_roi_toggle', { enabled: !adaptiveROI });
                  }}
                >
                  <Text style={styles.featureButtonText}>Adaptive ROI</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.featureButton, rrCorrectionEnabled ? styles.featureButtonActive : styles.featureButtonInactive]}
                  onPress={() => {
                    setRRCorrectionEnabled(!rrCorrectionEnabled);
                    logTelemetryEvent('rr_correction_toggle', { enabled: !rrCorrectionEnabled });
                  }}
                >
                  <Text style={styles.featureButtonText}>RR Correction</Text>
                </TouchableOpacity>
              </View>
              
              {/* Grid Size Control */}
              <View style={[styles.grid2col, { marginBottom: 16 }]}>
                <Text style={styles.detailKey}>Grid Size:</Text>
                <View style={{ flexDirection: 'row' }}>
                  {([1, 2, 3] as const).map(size => (
                    <TouchableOpacity 
                      key={size}
                      style={[
                        styles.gridButton, 
                        ppgGrid === size ? styles.gridButtonActive : styles.gridButtonInactive
                      ]}
                      onPress={() => {
                        setPpgGrid(size);
                        logTelemetryEvent('grid_size_change', { newSize: size });
                      }}
                    >
                      <Text style={styles.gridButtonText}>{size}x{size}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              {/* Base Metrics */}
              <View style={styles.grid2col}>
                <Text style={styles.detailItem}><Text style={styles.detailKey}>RR Sayısı:</Text> {String(Array.isArray((metrics as any)?.rrList) ? (metrics as any).rrList.length : 0)}</Text>
                <Text style={styles.detailItem}><Text style={styles.detailKey}>Peak Sayısı:</Text> {String(Array.isArray((metrics as any)?.peakList) ? (metrics as any).peakList.length : 0)}</Text>
                
                {/* RR Correction Stats */}
                {rrCorrectionEnabled && metrics?.quality?.correctedRRList && (
                  <>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>Corrected RR:</Text> {String(metrics.quality.correctedRRList.length)}
                    </Text>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>RR Outliers:</Text> {String(metrics.quality?.rrOutlierCount ?? 0)}
                    </Text>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>Correction Rate:</Text> {String(((metrics.quality?.rrCorrectionRatio ?? 0) * 100).toFixed(1))}%
                    </Text>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>Method:</Text> {String(metrics.quality?.rrCorrectionMethod ?? '—')}
                    </Text>
                  </>
                )}
                
                {/* Adaptive ROI Stats */}
                {adaptiveROI && (
                  <>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>Current ROI:</Text> {roi.toFixed(2)}
                    </Text>
                    <Text style={styles.detailItem}>
                      <Text style={styles.detailKey}>Signal History:</Text> {signalQualityHistoryRef.current.length}
                    </Text>
                  </>
                  )}
                </View>
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
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 8,
  },
  activeSmallButton: {
    backgroundColor: '#4CAF50',
  },
  inactiveSmallButton: {
    backgroundColor: '#757575',
  },
  smallButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  // ✅ PHASE 2: New UI element styles
  featureButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
    flex: 1,
  },
  featureButtonActive: {
    backgroundColor: '#4CAF50',
  },
  featureButtonInactive: {
    backgroundColor: '#757575',
  },
  featureButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  gridButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 4,
    minWidth: 35,
  },
  gridButtonActive: {
    backgroundColor: '#2196F3',
  },
  gridButtonInactive: {
    backgroundColor: '#E0E0E0',
  },
  gridButtonText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
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
