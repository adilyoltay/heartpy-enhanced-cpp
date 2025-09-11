/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, {useEffect} from 'react';
import type {PropsWithChildren} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import {
  Colors,
  DebugInstructions,
  Header,
  LearnMoreLinks,
  ReloadInstructions,
} from 'react-native/Libraries/NewAppScreen';
import {NativeModules} from 'react-native';

// Global JSI binding declaration
declare global {
  var __HeartPyAnalyze: (signal: number[], fs: number, options?: any) => any;
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

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };

  useEffect(() => {
    try {
      console.log('Available NativeModules:', Object.keys(NativeModules));
      console.log('HeartPyModule:', NativeModules.HeartPyModule);
      
      // Initialize JSI binding first
      if (NativeModules.HeartPyModule && NativeModules.HeartPyModule.installJSI) {
        console.log('Installing HeartPy JSI binding...');
        const installed = NativeModules.HeartPyModule.installJSI();
        console.log('JSI installation result:', installed);
        
        if (installed && global.__HeartPyAnalyze) {
          console.log('JSI binding installed successfully!');
        } else {
          console.warn('JSI binding installation failed');
          return;
        }
      } else {
        console.warn('HeartPyModule or installJSI method not available');
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
          <Section title="Step One">
            Edit <Text style={styles.highlight}>App.tsx</Text> to change this
            screen and then come back to see your edits.
          </Section>
          <Section title="See Your Changes">
            <ReloadInstructions />
          </Section>
          <Section title="Debug">
            <DebugInstructions />
          </Section>
          <Section title="Learn More">
            Read the docs to discover what to do next:
          </Section>
          <LearnMoreLinks />
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
});

export default App;
