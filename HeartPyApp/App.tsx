/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, {useEffect, useState} from 'react';
import type {PropsWithChildren} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  TouchableOpacity,
} from 'react-native';

import {
  Colors,
  DebugInstructions,
  Header,
  LearnMoreLinks,
  ReloadInstructions,
} from 'react-native/Libraries/NewAppScreen';
import {NativeModules} from 'react-native';
import HeartPyRunner from './HeartPyRunner';
import CameraPPGAnalyzer from './CameraPPGAnalyzer';

// Global JSI binding declaration
declare global {
  var __HeartPyAnalyze: ((signal: number[], fs: number, options?: any) => any) | undefined;
}

type SectionProps = PropsWithChildren<{
  title: string;
}>;

function Section({children, title}: SectionProps): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <View style={styles.sectionContainer}>
      <Text
        style={[
          styles.sectionTitle,
          {
            color: isDarkMode ? Colors.white : Colors.black,
          },
        ]}>
        {title}
      </Text>
      <Text
        style={[
          styles.sectionDescription,
          {
            color: isDarkMode ? Colors.light : Colors.dark,
          },
        ]}>
        {children}
      </Text>
    </View>
  );
}

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const [currentScreen, setCurrentScreen] = useState<'home' | 'camera'>('home');

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };

  useEffect(() => {
    try {
      console.log('Available NativeModules:', Object.keys(NativeModules));
      console.log('HeartPyModule:', NativeModules.HeartPyModule);
      console.log('Installing HeartPy JSI binding...');
      let installed = false;
      try {
        // Prefer the library wrapper if resolvable
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const heartpy = require('react-native-heartpy');
        if (heartpy && typeof heartpy.installJSI === 'function') {
          installed = !!heartpy.installJSI();
        }
      } catch (e) {
        console.warn('react-native-heartpy JS wrapper unavailable, falling back to NativeModules', e);
      }
      if (!installed && NativeModules.HeartPyModule?.installJSI) {
        try { installed = !!NativeModules.HeartPyModule.installJSI(); } catch {}
      }
      console.log('JSI installation result (boolean):', installed);
      if (installed && global.__HeartPyAnalyze) {
        console.log('JSI binding installed successfully!');
      } else {
        console.warn('JSI binding installation failed');
        return;
      }
      
      if (global.__HeartPyAnalyze) {
        const fs = 50;
        const N = 5000;
        const signal: number[] = [];
        
        // Generate a more realistic PPG-like signal with some noise
        for (let i = 0; i < N; i++) {
          const t = i / fs;
          const heartRate = 1.2; // 72 BPM
          const ppgSignal = Math.sin(2 * Math.PI * heartRate * t) + 
                           0.3 * Math.sin(2 * Math.PI * heartRate * 2 * t) + // harmonic
                           0.1 * Math.sin(2 * Math.PI * 0.25 * t) + // breathing artifact
                           0.05 * (Math.random() - 0.5); // noise
          signal.push(ppgSignal + 512); // offset to positive values
        }
        
        // Test basic analysis using JSI binding
        console.log('Testing basic HeartPy analysis...');
        const basicRes = global.__HeartPyAnalyze(signal, fs, {
          bandpass: {lowHz: 0.5, highHz: 5, order: 2},
          welch: {nfft: 256, overlap: 0.5},
          peak: {refractoryMs: 250, thresholdScale: 0.5, bpmMin: 40, bpmMax: 180},
        });
        console.log('Basic analysis result:', {
          bpm: basicRes.bpm,
          sdnn: basicRes.sdnn,
          rmssd: basicRes.rmssd,
          pnn50: basicRes.pnn50,
          lfhf: basicRes.lfhf,
          breathingRate: basicRes.breathingRate,
          quality: basicRes.quality
        });
        
        // Test analysis with preprocessing
        console.log('Testing HeartPy with preprocessing...');
        const preprocessedRes = global.__HeartPyAnalyze(signal, fs, {
          bandpass: {lowHz: 0.5, highHz: 5, order: 2},
          welch: {nfft: 256, overlap: 0.5},
          peak: {refractoryMs: 250, thresholdScale: 0.3},
          preprocessing: {
            interpClipping: true,
            clippingThreshold: 1000,
            hampelCorrect: true,
            hampelWindow: 6,
            hampelThreshold: 3.0,
            removeBaselineWander: true,
            enhancePeaks: false
          },
          quality: {
            rejectSegmentwise: false,
            cleanRR: true,
            cleanMethod: 'quotient-filter'
          }
        });
        console.log('Preprocessed analysis result:', {
          bpm: preprocessedRes.bpm,
          sdnn: preprocessedRes.sdnn,
          rmssd: preprocessedRes.rmssd,
          mad: preprocessedRes.mad,
          sd1: preprocessedRes.sd1,
          sd2: preprocessedRes.sd2,
          totalPower: preprocessedRes.totalPower,
          lfNorm: preprocessedRes.lfNorm,
          hfNorm: preprocessedRes.hfNorm,
          quality: preprocessedRes.quality
        });
        
        // Test RR interval analysis
        if (basicRes.rrList && basicRes.rrList.length > 10) {
          console.log('Testing RR interval analysis...');
          // Simulate calling analyzeRR if it exists
          console.log('RR intervals available:', basicRes.rrList.length);
          console.log('Sample RR intervals:', basicRes.rrList.slice(0, 5));
        }
        
      } else {
        console.warn('HeartPyModule not available');
      }
    } catch (e) {
      console.warn('HeartPy analyze error', e);
      console.error(e);
    }
  }, []);

  if (currentScreen === 'camera') {
    return (
      <SafeAreaView style={[backgroundStyle, { flex: 1 }]}>
        <StatusBar
          barStyle={isDarkMode ? 'light-content' : 'dark-content'}
          backgroundColor={backgroundStyle.backgroundColor}
        />
        <View style={styles.headerBar}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => setCurrentScreen('home')}
          >
            <Text style={styles.backButtonText}>← Ana Sayfa</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Real-time PPG Analiz</Text>
        </View>
        <CameraPPGAnalyzer />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={backgroundStyle}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundStyle.backgroundColor}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={backgroundStyle}>
        <Header />
        <View
          style={{
            backgroundColor: isDarkMode ? Colors.black : Colors.white,
          }}>
          
          {/* Kamera PPG Butonu */}
          <TouchableOpacity 
            style={styles.cameraButton} 
            onPress={() => setCurrentScreen('camera')}
          >
            <Text style={styles.cameraButtonText}>
              📱 Kamera ile Kalp Atışı Ölç
            </Text>
            <Text style={styles.cameraButtonSubtext}>
              Real-time PPG analizi ile anlık kalp atışı ve HRV metrikleri
            </Text>
          </TouchableOpacity>

          <HeartPyRunner />
          <Section title="HeartPy Enhanced">
            <Text>
              Bu uygulama HeartPy Python kütüphanesinin C++ portunu kullanarak 
              yüksek performanslı kalp atışı ve HRV analizi sağlar.
            </Text>
          </Section>
          <Section title="Özellikler">
            <Text>
              • Real-time PPG analizi{'\n'}
              • 1000x daha hızlı işleme{'\n'}
              • JSI ve streaming desteği{'\n'}
              • Kapsamlı HRV metrikleri{'\n'}
              • Bilimsel doğrulanmış algoritma
            </Text>
          </Section>
          <Section title="Debug">
            <DebugInstructions />
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
  },
  highlight: {
    fontWeight: '700',
  },
  // Kamera özelliği stilleri
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginRight: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  cameraButton: {
    backgroundColor: '#4CAF50',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cameraButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  cameraButtonSubtext: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default App;
