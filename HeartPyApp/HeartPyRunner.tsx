import React, { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
// Lazy-resolve HeartPy to avoid Metro issues when using local package links
function getHeartPy() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-heartpy');
  } catch (e) {
    return null;
  }
}
function getBenchmark() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../react-native-heartpy/examples/Benchmark60s');
  } catch (e) {
    return null;
  }
}

export default function HeartPyRunner() {
  const [lines, setLines] = useState<string[]>([]);
  const log = (s: string) => setLines(v => [...v, s]);

  const onRun = async () => {
    try {
      const HP = getHeartPy();
      if (!HP?.RealtimeAnalyzer) {
        log('react-native-heartpy not available');
        return;
      }
      const bench = getBenchmark();
      const runBenchmark60s = bench?.runBenchmark60s;
      HP.RealtimeAnalyzer.setConfig?.({ debug: true, zeroCopyEnabled: true, jsiEnabled: true });
      if (runBenchmark60s) {
        log('Running 60s JSI...');
        const jsi = await runBenchmark60s('jsi', 50);
        log('JSI report: ' + JSON.stringify(jsi));
      }

      // Optional native JSI stats if available
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { NativeModules } = require('react-native');
        const stats = NativeModules?.HeartPyModule?.getJSIStats?.();
        if (stats) log('JSI Stats: ' + JSON.stringify(stats));
      } catch {}

      if (runBenchmark60s) {
        HP.RealtimeAnalyzer.setConfig?.({ jsiEnabled: false, debug: true });
        log('Running 60s NM...');
        const nm = await runBenchmark60s('nm', 50);
        log('NM report: ' + JSON.stringify(nm));
      }

      // Test errors on JSI path
      HP.RealtimeAnalyzer.setConfig?.({ jsiEnabled: true, debug: true });
      try { await HP.RealtimeAnalyzer.create(0 as any, {} as any); } catch (e: any) {
        log(`JSI create(0,{}) -> ${e?.code} ${e?.message}`);
      }
      try {
        const jsiAnalyzer = await HP.RealtimeAnalyzer.create(50, {} as any);
        try { await jsiAnalyzer.push(new Float32Array(0)); } catch (e: any) {
          log(`JSI push(Float32Array(0)) -> ${e?.code} ${e?.message}`);
        }
        await jsiAnalyzer.destroy();
      } catch {}

      // Test errors on NM path  
      HP.RealtimeAnalyzer.setConfig?.({ jsiEnabled: false, debug: true });
      try { await HP.RealtimeAnalyzer.create(0 as any, {} as any); } catch (e: any) {
        log(`NM create(0,{}) -> ${e?.code} ${e?.message}`);
      }
      try {
        const nmAnalyzer = await HP.RealtimeAnalyzer.create(50, {} as any);
        try { await nmAnalyzer.push([]); } catch (e: any) {
          log(`NM push([]) -> ${e?.code} ${e?.message}`);
        }
        await nmAnalyzer.destroy();
      } catch {}

      log('Done');
    } catch (e: any) {
      log('Runner error: ' + (e?.message ?? String(e)));
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>HeartPy Runner</Text>
      <Button title="Run 60s (JSI then NM)" onPress={onRun} />
      {lines.map((s, i) => (
        <Text key={i} style={styles.log}>{s}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, margin: 12 },
  title: { fontWeight: '600', marginBottom: 8 },
  log: { fontFamily: 'Courier', fontSize: 12, marginTop: 6 },
});
