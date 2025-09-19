# 🎯 Clean PPG App - Development Tasks

## Mission: Build minimal, type-safe PPG app with 6 files, single responsibility, C++ isolation

---

## 📋 TASK LIST

### **Phase 1: Foundation** `[1 day]`

#### Task 1.1: TypeScript Definitions `[30 min]`
```typescript
// File: src/types/PPGTypes.ts
□ Create PPGSample interface { value: number, timestamp: number }
□ Create PPGMetrics interface { bpm, confidence, snr, quality }
□ Create PPGState type 'idle' | 'starting' | 'running' | 'stopping'
□ Create PPGError type 'camera' | 'native' | 'buffer' | 'config'
□ Export all with readonly properties
```

#### Task 1.2: Configuration Constants `[15 min]`
```typescript
// File: src/core/PPGConfig.ts
□ Camera config { fps: 30, torchLevel: 0.3, roi: 0.5 }
□ Analysis config { sampleRate: 30, bufferSize: 450, analysisWindow: 150 }
□ UI config { updateInterval: 100, waveformSamples: 150 }
□ Use 'as const' for type safety
```

#### Task 1.3: Native C++ Wrapper `[2 hours]`
```typescript
// File: src/core/HeartPyWrapper.ts
□ Class with private analyzer instance
□ Method: create() - initialize native module
□ Method: push(samples: Float32Array) - send data to C++
□ Method: poll() - get metrics from C++
□ Method: destroy() - cleanup
□ Handle TypedArray conversion
□ Throw PPGError on failures
```

### **Phase 2: Core Logic** `[1 day]`

#### Task 2.1: Ring Buffer `[1 hour]`
```typescript
// File: src/core/RingBuffer.ts
□ Generic class RingBuffer<T>
□ Constructor(capacity: number)
□ Method: push(item: T) - O(1) insert
□ Method: getAll() - return T[] copy
□ Method: clear() - reset buffer
□ Method: isFull() - check capacity
□ Private: buffer, head, tail, count
```

#### Task 2.2: PPG Analyzer `[3 hours]`
```typescript
// File: src/core/PPGAnalyzer.ts
□ Class with PPGState FSM
□ Private: RingBuffer<PPGSample>, HeartPyWrapper, timer
□ Method: start() - idle → starting → running
□ Method: stop() - running → stopping → idle
□ Method: addSample(sample) - push to buffer
□ Method: getMetrics() - return current metrics
□ Single setInterval for all operations
□ State validation before transitions
```

### **Phase 3: UI Components** `[1 day]`

#### Task 3.1: Camera Component `[2 hours]`
```typescript
// File: src/components/PPGCamera.tsx
□ Props: { onSample: (sample: PPGSample) => void }
□ VisionCamera setup with frame processor
□ Extract PPG value from green channel
□ Calculate timestamp from frame
□ Call onSample callback
□ NO state management, NO UI controls
```

#### Task 3.2: Display Component `[2 hours]`
```typescript
// File: src/components/PPGDisplay.tsx
□ Props: { metrics, state, onStart, onStop }
□ Display BPM, confidence, SNR, quality
□ Simple line chart for waveform
□ Start/Stop buttons
□ Status indicator (idle/starting/running/stopping)
□ NO business logic, only UI rendering
```

#### Task 3.3: Main App `[1 hour]`
```typescript
// File: App.tsx
□ Create PPGAnalyzer instance
□ useState for metrics and state
□ Connect PPGCamera.onSample → analyzer.addSample
□ Connect analyzer metrics → PPGDisplay
□ Connect PPGDisplay buttons → analyzer.start/stop
□ Error boundary for crash handling
```

---

## ✅ ACCEPTANCE CRITERIA

### Each Task Must:
- [ ] TypeScript compiles with zero errors
- [ ] File size < 200 lines
- [ ] Function size < 20 lines
- [ ] No 'any' types used
- [ ] ESLint/Prettier applied
- [ ] Git commit with descriptive message

### Final App Must:
- [ ] Build on iOS device
- [ ] Display real PPG data from camera
- [ ] Show BPM and confidence metrics
- [ ] Start/stop operations work
- [ ] Handle errors gracefully
- [ ] Total files: exactly 6
- [ ] Total lines: < 1,200

---

## 🎯 SUCCESS METRICS
- Build time: < 15 seconds
- Memory usage: < 30MB
- Hot reload: < 1 second
- CPU usage: < 5% average
- Zero crashes during normal operation

---

## 🚫 CONSTRAINTS
- NO external UI libraries
- NO state management libraries  
- NO more than 1 timer total
- NO mutable props
- NO business logic in components
- NO C++ logic in UI components
