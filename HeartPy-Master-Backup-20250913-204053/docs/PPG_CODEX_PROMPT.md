# 🎯 Clean PPG App Development Codex

## Mission
Build a minimal PPG application with **6 files only**, using **single responsibility principle**, **full TypeScript typing**, and **isolated C++ wrapper**. The app must show real-time BPM and confidence from camera PPG data using a single timer and FSM-based state management.

## 📁 File Structure (Exactly 6 Files)

```
src/
├── core/
│   ├── PPGTypes.ts      // All types, interfaces, and config constants
│   ├── HeartPyWrapper.ts // Thin C++ isolation layer  
│   ├── RingBuffer.ts     // Generic circular buffer
│   └── PPGEngine.ts      // FSM, single timer, business logic
├── components/
│   └── PPGCamera.tsx     // Camera frame processor only
└── App.tsx              // UI container with display logic
```

## 📋 Implementation Tasks

### Phase 1: Foundation [4 hours]

#### Task 1.1: PPGTypes.ts [30 min]
```typescript
// Define all types and configuration in single source of truth
export interface PPGSample {
  readonly value: number;
  readonly timestamp: number; // milliseconds
}

export interface PPGMetrics {
  readonly bpm: number;
  readonly confidence: number;
  readonly snrDb: number;
  readonly quality: 'good' | 'poor' | 'unknown';
}

export type PPGState = 'idle' | 'starting' | 'running' | 'recover' | 'stopping';

export type PPGError = {
  readonly code: 'camera' | 'native' | 'buffer' | 'config';
  readonly message: string;
};

export const PPG_CONFIG = {
  camera: { fps: 30, roi: 0.5, torchLevel: 0.3 },
  analysis: {
    sampleRate: 30,
    bufferSize: 450, // 15 seconds at 30Hz
    pollMs: 200,
    warmupMs: 3000,
    minRunMs: 7000,
    recoverMs: 2000,
  },
  ui: { waveformSamples: 150, updateMs: 100 },
  quality: {
    snrGood: 6,
    confGood: 0.3,
    snrPoor: 3,
    confPoor: 0.1,
  },
} as const;
```

#### Task 1.2: HeartPyWrapper.ts [2 hours]
```typescript
// Isolate C++ module with typed interface
export class HeartPyWrapper {
  private handle: any = null; // Native handle
  
  async create(fs: number, config: object): Promise<void> {
    // Initialize native analyzer
  }
  
  async push(samples: Float32Array): Promise<void> {
    // Push samples to C++
  }
  
  async pushWithTimestamps(samples: Float32Array, timestamps: Float64Array): Promise<void> {
    // Push with timestamps
  }
  
  async poll(): Promise<NativePollResult> {
    // Get metrics from C++
  }
  
  async destroy(): Promise<void> {
    // Cleanup native resources
  }
}
```

#### Task 1.3: RingBuffer.ts [1 hour]
```typescript
// Efficient circular buffer implementation
export class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private length = 0;
  
  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }
  
  push(item: T): void {
    // O(1) insertion
  }
  
  getAll(): T[] {
    // Return ordered copy
  }
  
  clear(): void {
    // Reset buffer
  }
}
```

### Phase 2: Core Engine [4 hours]

#### Task 2.1: PPGEngine.ts [4 hours]
```typescript
// Single timer FSM with all business logic
export class PPGEngine {
  private state: PPGState = 'idle';
  private buffer = new RingBuffer<PPGSample>(PPG_CONFIG.analysis.bufferSize);
  private wrapper = new HeartPyWrapper();
  private timer: NodeJS.Timeout | null = null;
  private metrics: PPGMetrics | null = null;
  
  // FSM timestamps
  private startedAt = 0;
  private recoverUntil = 0;
  
  // Callback for metrics updates
  constructor(private onMetrics: (metrics: PPGMetrics) => void) {}
  
  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error('Already running');
    
    await this.wrapper.create(PPG_CONFIG.analysis.sampleRate, {
      bandpass: { lowHz: 0.5, highHz: 3.5, order: 3 },
      peak: { refractoryMs: 280, bpmMin: 40, bpmMax: 180 },
    });
    
    this.state = 'starting';
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), PPG_CONFIG.analysis.pollMs);
  }
  
  async stop(): Promise<void> {
    if (this.state === 'idle') return;
    
    this.state = 'stopping';
    if (this.timer) clearInterval(this.timer);
    await this.wrapper.destroy();
    this.state = 'idle';
  }
  
  addSample(sample: PPGSample): void {
    if (this.state === 'running' || this.state === 'starting') {
      this.buffer.push(sample);
    }
  }
  
  private async tick(): Promise<void> {
    const samples = this.buffer.getAll();
    if (samples.length === 0) return;
    
    // Push to C++ and poll results
    const values = new Float32Array(samples.map(s => s.value));
    await this.wrapper.push(values);
    const result = await this.wrapper.poll();
    
    // FSM state transitions
    const now = Date.now();
    const elapsed = now - this.startedAt;
    
    switch (this.state) {
      case 'starting':
        if (elapsed >= PPG_CONFIG.analysis.warmupMs && this.isReady(result)) {
          this.state = 'running';
        }
        break;
        
      case 'running':
        if (this.isPoor(result)) {
          this.state = 'recover';
          this.recoverUntil = now + PPG_CONFIG.analysis.recoverMs;
        }
        break;
        
      case 'recover':
        if (!this.isPoor(result)) {
          this.state = 'running';
        } else if (now >= this.recoverUntil && elapsed >= PPG_CONFIG.analysis.minRunMs) {
          await this.stop();
        }
        break;
    }
    
    // Update metrics
    if (result && this.state === 'running') {
      this.metrics = this.mapToMetrics(result);
      this.onMetrics(this.metrics);
    }
  }
  
  private isReady(result: any): boolean {
    return result.confidence > 0.05 || result.snrDb > 1 || result.quality?.totalBeats >= 12;
  }
  
  private isPoor(result: any): boolean {
    return result.confidence <= PPG_CONFIG.quality.confPoor &&
           result.snrDb <= PPG_CONFIG.quality.snrPoor &&
           !result.quality?.goodQuality;
  }
  
  private mapToMetrics(result: any): PPGMetrics {
    return {
      bpm: result.bpm || 0,
      confidence: result.confidence || 0,
      snrDb: result.snrDb || 0,
      quality: result.quality?.goodQuality ? 'good' : 'poor',
    };
  }
  
  getSnapshot(): { state: PPGState; metrics: PPGMetrics | null; waveform: number[] } {
    const samples = this.buffer.getAll();
    const waveform = samples.slice(-PPG_CONFIG.ui.waveformSamples).map(s => s.value);
    return { state: this.state, metrics: this.metrics, waveform };
  }
}
```

### Phase 3: UI Components [4 hours]

#### Task 3.1: PPGCamera.tsx [2 hours]
```typescript
// Camera component - data producer only
import { Camera, useFrameProcessor } from 'react-native-vision-camera';

interface Props {
  readonly onSample: (sample: PPGSample) => void;
}

export function PPGCamera({ onSample }: Props) {
  const device = useCameraDevice('back');
  
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // Extract green channel mean from ROI
    const value = extractPPGValue(frame); // Native plugin call
    const timestamp = frame.timestamp || Date.now();
    
    runOnJS(onSample)({ value, timestamp });
  }, [onSample]);
  
  if (!device) return <Text>No camera</Text>;
  
  return (
    <Camera
      style={{ flex: 1 }}
      device={device}
      isActive={true}
      frameProcessor={frameProcessor}
      fps={PPG_CONFIG.camera.fps}
      torch={PPG_CONFIG.camera.torchLevel > 0 ? 'on' : 'off'}
    />
  );
}
```

#### Task 3.2: App.tsx [2 hours]
```typescript
// Main app - UI container and display
export default function App() {
  const engineRef = useRef<PPGEngine>();
  const [metrics, setMetrics] = useState<PPGMetrics | null>(null);
  const [state, setState] = useState<PPGState>('idle');
  const [waveform, setWaveform] = useState<number[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  
  useEffect(() => {
    engineRef.current = new PPGEngine((m) => setMetrics(m));
    
    // UI update timer
    const timer = setInterval(() => {
      if (engineRef.current) {
        const snapshot = engineRef.current.getSnapshot();
        setState(snapshot.state);
        setWaveform(snapshot.waveform);
      }
    }, PPG_CONFIG.ui.updateMs);
    
    return () => {
      clearInterval(timer);
      engineRef.current?.stop();
    };
  }, []);
  
  const handleStart = async () => {
    try {
      await engineRef.current?.start();
      setIsRunning(true);
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };
  
  const handleStop = async () => {
    await engineRef.current?.stop();
    setIsRunning(false);
    setMetrics(null);
  };
  
  const handleSample = useCallback((sample: PPGSample) => {
    engineRef.current?.addSample(sample);
  }, []);
  
  return (
    <View style={styles.container}>
      {isRunning && <PPGCamera onSample={handleSample} />}
      
      <View style={styles.metrics}>
        <Text style={styles.bpm}>{metrics?.bpm || '--'} BPM</Text>
        <Text>Confidence: {(metrics?.confidence || 0).toFixed(2)}</Text>
        <Text>SNR: {(metrics?.snrDb || 0).toFixed(1)} dB</Text>
        <Text>Quality: {metrics?.quality || 'unknown'}</Text>
        <Text>State: {state}</Text>
      </View>
      
      <View style={styles.waveform}>
        {/* Simple waveform visualization */}
        <Svg width="100%" height={100}>
          <Polyline
            points={waveform.map((v, i) => `${i * 2},${50 - v * 40}`).join(' ')}
            stroke="red"
            strokeWidth="2"
            fill="none"
          />
        </Svg>
      </View>
      
      <TouchableOpacity
        style={[styles.button, isRunning && styles.stopButton]}
        onPress={isRunning ? handleStop : handleStart}
      >
        <Text style={styles.buttonText}>
          {isRunning ? 'Stop' : 'Start'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  metrics: { padding: 20, backgroundColor: '#111' },
  bpm: { fontSize: 48, color: '#fff', fontWeight: 'bold' },
  waveform: { height: 100, backgroundColor: '#222' },
  button: { margin: 20, padding: 15, backgroundColor: '#4CAF50', borderRadius: 8 },
  stopButton: { backgroundColor: '#F44336' },
  buttonText: { color: '#fff', fontSize: 18, textAlign: 'center' },
});
```

## ✅ Acceptance Criteria

### Code Quality
- [ ] Zero TypeScript errors
- [ ] No 'any' types (except native handle)
- [ ] Each file < 200 lines
- [ ] Each function < 20 lines
- [ ] ESLint + Prettier applied

### Functionality
- [ ] Builds on iOS device
- [ ] Shows real PPG data from camera
- [ ] Displays BPM, confidence, SNR
- [ ] FSM transitions work correctly
- [ ] Single timer (in PPGEngine)
- [ ] Exactly 6 files

### Performance
- [ ] Build time < 15 seconds
- [ ] Memory usage < 30MB
- [ ] CPU usage < 5% average
- [ ] Hot reload < 1 second

## 🚫 Constraints
- NO external UI libraries
- NO state management libraries
- NO multiple timers (only one in PPGEngine)
- NO mutable props
- NO business logic in components
- NO C++ logic outside HeartPyWrapper

## 📝 Git Commit Structure
```bash
# Phase 1
git commit -m "feat(core): add PPGTypes with interfaces and config"
git commit -m "feat(core): implement HeartPyWrapper for C++ isolation"
git commit -m "feat(core): add generic RingBuffer implementation"

# Phase 2
git commit -m "feat(engine): implement PPGEngine with FSM and single timer"

# Phase 3
git commit -m "feat(ui): add PPGCamera component for frame processing"
git commit -m "feat(ui): implement App with metrics display and controls"
```

## 🎯 Definition of Done
- [ ] All 6 files created and working
- [ ] iOS device shows real-time BPM
- [ ] FSM handles all state transitions
- [ ] No crashes during 5-minute test
- [ ] Code review passed
- [ ] Documentation complete
