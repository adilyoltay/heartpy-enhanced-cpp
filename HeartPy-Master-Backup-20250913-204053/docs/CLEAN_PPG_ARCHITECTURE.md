# 🏗️ Clean PPG Architecture Design

## 📋 File Structure (6 Core Files)

```
src/
├── types/
│   └── PPGTypes.ts           // All TypeScript definitions
├── core/
│   ├── HeartPyWrapper.ts     // Thin C++ native wrapper
│   ├── PPGAnalyzer.ts        // Ring buffer + FSM logic
│   └── PPGConfig.ts          // Centralized configuration
├── components/
│   ├── PPGCamera.tsx         // Camera + frame processing only
│   └── PPGDisplay.tsx        // UI + metrics display only
└── App.tsx                   // Main app container
```

## 🎯 Single Responsibility Principle

### 1. PPGTypes.ts - Type Definitions
```typescript
// All types in one place
export interface PPGSample {
  value: number;
  timestamp: number;
}

export interface PPGMetrics {
  bpm: number;
  confidence: number;
  snr: number;
  rmssd: number;
  quality: boolean;
}

export type PPGState = 'idle' | 'starting' | 'running' | 'stopping';

export interface PPGConfig {
  sampleRate: number;
  bufferSize: number;
  analysisWindow: number;
}
```

### 2. HeartPyWrapper.ts - C++ Native Isolation
```typescript
// Thin wrapper around native C++ module
class HeartPyWrapper {
  private analyzer: any = null;
  
  async create(config: PPGConfig): Promise<void>
  async push(samples: PPGSample[]): Promise<void>
  async poll(): Promise<PPGMetrics>
  async destroy(): Promise<void>
}
```

### 3. PPGAnalyzer.ts - Core Logic
```typescript
// Ring buffer + FSM + business logic
class PPGAnalyzer {
  private state: PPGState = 'idle';
  private buffer: RingBuffer<PPGSample>;
  private wrapper: HeartPyWrapper;
  
  start(): Promise<void>
  addSample(sample: PPGSample): void
  getMetrics(): PPGMetrics | null
  stop(): Promise<void>
}
```

### 4. PPGCamera.tsx - Camera Only
```typescript
// Only camera and frame processing
export function PPGCamera({ onSample }: { onSample: (sample: PPGSample) => void }) {
  // VisionCamera setup
  // Frame processor
  // PPG value extraction
  // Callback to parent
}
```

### 5. PPGDisplay.tsx - UI Only
```typescript
// Only UI rendering and user interaction
export function PPGDisplay({ 
  metrics, 
  state, 
  onStart, 
  onStop 
}: PPGDisplayProps) {
  // Metrics display
  // Waveform chart
  // Control buttons
  // Status indicators
}
```

### 6. App.tsx - Container
```typescript
// Orchestrates all components
export default function App() {
  const analyzer = usePPGAnalyzer();
  
  return (
    <View>
      <PPGCamera onSample={analyzer.addSample} />
      <PPGDisplay 
        metrics={analyzer.metrics}
        state={analyzer.state}
        onStart={analyzer.start}
        onStop={analyzer.stop}
      />
    </View>
  );
}
```

## 🔄 Data Flow

```
Camera → PPGSample → RingBuffer → C++Analyzer → PPGMetrics → UI
   ↑                    ↑             ↑            ↑         ↑
PPGCamera.tsx    PPGAnalyzer.ts  HeartPyWrapper.ts  PPGDisplay.tsx
```

## 🛡️ Error Handling

```typescript
// Centralized error handling
class PPGError extends Error {
  constructor(
    message: string, 
    public code: 'CAMERA' | 'NATIVE' | 'BUFFER' | 'CONFIG',
    public recoverable: boolean = true
  ) {
    super(message);
  }
}
```

## 🎛️ Configuration

```typescript
// Single source of truth
export const PPG_CONFIG = {
  camera: {
    fps: 30,
    torchLevel: 0.3,
    roi: 0.5
  },
  analysis: {
    sampleRate: 30,
    bufferSize: 450, // 15 seconds
    analysisWindow: 150, // 5 seconds
    minConfidence: 0.3
  },
  ui: {
    updateInterval: 100,
    waveformSamples: 150
  }
} as const;
```

## 🔄 State Management

```typescript
// Simple FSM with clear transitions
type PPGState = 'idle' | 'starting' | 'running' | 'stopping';

const FSM_TRANSITIONS = {
  idle: ['starting'],
  starting: ['running', 'idle'],
  running: ['stopping'],
  stopping: ['idle']
} as const;
```

## 🚀 Benefits

### ✅ Maintainability
- Each file has single responsibility
- Easy to test individual components
- Clear separation of concerns

### ✅ Type Safety
- All interfaces defined in one place
- No `any` types in business logic
- Compile-time error catching

### ✅ Performance
- Ring buffer for efficient memory usage
- Minimal re-renders with proper state management
- Native C++ isolation prevents JS blocking

### ✅ Reliability
- FSM prevents invalid state transitions
- Error boundaries for graceful failure
- Defensive programming throughout

### ✅ Extensibility
- Easy to add new features
- Plugin architecture for different analyzers
- Configuration-driven behavior

## 📊 Metrics

- **Total Files**: 6 (vs current 1 massive file)
- **Max Lines per File**: ~200 (vs current 3,087)
- **Type Safety**: 100% (vs current mixed)
- **State Variables**: ~10 total (vs current 70+)
- **Timers**: 1 (vs current 5)

## 🔧 Implementation Priority

### Phase 1: Core Infrastructure (Week 1)
1. PPGTypes.ts - Define all interfaces
2. PPGConfig.ts - Centralized configuration  
3. HeartPyWrapper.ts - Native module wrapper

### Phase 2: Business Logic (Week 2)
4. PPGAnalyzer.ts - Ring buffer + FSM
5. Error handling and testing

### Phase 3: UI Components (Week 3)
6. PPGCamera.tsx - Camera component
7. PPGDisplay.tsx - UI component
8. App.tsx - Integration

### Phase 4: Polish & Optimization (Week 4)
9. Performance optimization
10. Error boundaries
11. Documentation
12. Testing

## 🎯 Success Criteria

- **Build Time**: <30 seconds (vs current variable)
- **Hot Reload**: <2 seconds (vs current >5 seconds)
- **Memory Usage**: <50MB (vs current >100MB)
- **CPU Usage**: <10% (vs current >20%)
- **Lines of Code**: <1,200 total (vs current 3,087)
- **Type Coverage**: 100% (vs current ~80%)

This architecture provides a solid foundation for a maintainable, performant, and extensible PPG application while keeping complexity to a minimum.
