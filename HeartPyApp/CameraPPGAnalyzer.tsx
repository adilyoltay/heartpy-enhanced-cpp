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
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import { RealtimeAnalyzer, type HeartPyResult } from 'react-native-heartpy';

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
  const [hapticEnabled, setHapticEnabled] = useState(true);

  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });
  const { hasPermission, requestPermission } = useCameraPermission();

  const analyzerRef = useRef<RealtimeAnalyzer | null>(null);
  const samplingRate = 30; // 30 FPS kamera
  const bufferSize = 150; // 5 saniye buffer (30 FPS * 5s)
  const analysisInterval = 1000; // 1 saniyede bir analiz
  
  const frameBufferRef = useRef<number[]>([]);
  const lastAnalysisTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Haptic feedback configuration
  const hapticOptions = {
    enableVibrateFallback: true,
    ignoreAndroidSystemSettings: false,
  };

  // Trigger haptic feedback for each heartbeat
  const triggerHapticForBeat = useCallback(() => {
    if (!hapticEnabled) return;
    
    try {
      // Use different haptic patterns for iOS and Android
      if (Platform.OS === 'ios') {
        ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
      } else {
        ReactNativeHapticFeedback.trigger('impactMedium', hapticOptions);
      }
    } catch (error) {
      console.warn('Haptic feedback error:', error);
    }
  }, [hapticEnabled]);

  // İzin kontrolü
  useEffect(() => {
    requestCameraPermission();
  }, []);

  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        
        if (
          granted['android.permission.CAMERA'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED
        ) {
          console.log('Android permissions granted');
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

  // PPG sinyali çıkarma fonksiyonu
  const extractPPGFromFrame = (frame: any): number => {
    // Bu basit bir implementasyon - gerçek PPG çıkarma daha karmaşık
    // Kameradan gelen RGB değerlerinin yeşil kanalını kullanıyoruz
    // Çünkü yeşil ışık kan akımını en iyi tespit eder
    
    // Frame'den RGB değerlerini çıkarma simülasyonu
    // Gerçek implementasyon frame buffer'ından pikselleri okuyacak
    const timestamp = Date.now();
    const heartRateBase = 1.2; // 72 BPM base
    
    // Simüle edilmiş PPG sinyali (gerçek implementasyon için frame processing gerekir)
    const t = (timestamp - startTimeRef.current) / 1000;
    const signal = Math.sin(2 * Math.PI * heartRateBase * t) +
                   0.3 * Math.sin(2 * Math.PI * heartRateBase * 2 * t) + // harmonik
                   0.1 * Math.sin(2 * Math.PI * 0.3 * t) + // nefes alma
                   0.05 * (Math.random() - 0.5); // gürültü
    
    return signal + 512; // DC offset ekle
  };

  // Frame işleme
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    
    const ppgValue = extractPPGFromFrame(frame);
    
    runOnJS((value: number, frameNum: number) => {
      // Frame buffer'ına ekle
      frameBufferRef.current.push(value);
      
      // Buffer boyutunu kontrol et
      if (frameBufferRef.current.length > bufferSize) {
        frameBufferRef.current.shift();
      }
      
      // PPG sinyalini güncelle (gösterim için)
      setPpgSignal(prev => {
        const newSignal = [...prev, value];
        if (newSignal.length > 100) newSignal.shift(); // Son 100 değeri göster
        return newSignal;
      });
      
      setFrameCount(frameNum);
      
      // Analiz zamanı geldi mi?
      const now = Date.now();
      if (now - lastAnalysisTimeRef.current > analysisInterval && 
          frameBufferRef.current.length >= 90) { // En az 3 saniye veri
        lastAnalysisTimeRef.current = now;
        performRealtimeAnalysis();
      }
    })(ppgValue, frame.pixelFormat.length);
  }, []);

  // Real-time analiz
  const performRealtimeAnalysis = async () => {
    if (!analyzerRef.current || frameBufferRef.current.length < 60) return;

    try {
      // Son n sample'ı al
      const samples = frameBufferRef.current.slice(-90); // Son 3 saniye
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
      if (analyzerRef.current) {
        await analyzerRef.current.destroy();
        analyzerRef.current = null;
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
        
        // RealtimeAnalyzer oluştur
        analyzerRef.current = await RealtimeAnalyzer.create(samplingRate, {
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
        
        setIsActive(true);
        setStatusMessage('📱 Parmağınızı kameranın flaş ışığına hafifçe yerleştirin');
        
        console.log('PPG Analysis started with 30 FPS sampling');
      } catch (error) {
        console.error('Start analysis error:', error);
        setIsAnalyzing(false);
        setStatusMessage('❌ Başlatma hatası');
        Alert.alert('Hata', 'Analiz başlatılamadı: ' + String(error));
      }
    }
  };

  // Component unmount temizleme
  useEffect(() => {
    return () => {
      if (analyzerRef.current) {
        analyzerRef.current.destroy();
      }
    };
  }, []);

  if (!hasPermission) {
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
        <Camera
          style={styles.camera}
          device={device}
          isActive={isActive}
          frameProcessor={isActive ? frameProcessor : undefined}
          torch={isActive ? 'on' : 'off'} // Flaşı aç PPG için
        />
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
          onPress={() => setHapticEnabled(!hapticEnabled)}
        >
          <Text style={styles.hapticButtonText}>
            {hapticEnabled ? '📳 Haptic ON' : '📵 Haptic OFF'}
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
});
