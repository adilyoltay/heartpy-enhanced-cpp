# Sample Stream Fix Test Checklist

## 🎯 **Kritik Testler**

### **1. Sample Stream Aktifliği**
- [ ] **PPGCamera** log'larında `[PPGCamera] Received valid sample` görünüyor
- [ ] **NaN sample** log'ları azaldı (sadece gerçek low signal'da)
- [ ] **HeartPyWrapper** log'larında `pushWithTimestamps` batch'leri görünüyor

### **2. HeartPy Warm-up**
- [ ] **Native confidence = 0** warm-up sırasında korunuyor
- [ ] **Kamera confidence fallback** sadece native undefined/NaN durumunda
- [ ] **SNR > 0** warm-up sonrasında görünüyor

### **3. Peak Visualization**
- [ ] **Peak çubukları** grafikte görünüyor (kırmızı)
- [ ] **Ring buffer** gerçek doluluğa göre normalize ediliyor
- [ ] **Peak filtering** doğru çalışıyor

### **4. UI Responsiveness**
- [ ] **BPM değeri** warm-up sonrasında görünüyor
- [ ] **Haptic feedback** güvenilir BPM'de çalışıyor
- [ ] **Status mesajları** doğru durumları gösteriyor

### **5. DC/Saturasyon Toparlanması**
- [ ] **Torch açma/kapama** sonrası hızlı toparlanma
- [ ] **Parmak kaldırma/yerleştirme** sonrası hızlı toparlanma
- [ ] **Confidence** saturasyon sırasında 0'a düşmüyor

## 🔍 **Log Monitoring**

### **Başarılı Sample Stream:**
```
[PPGCamera] Received valid sample from NativeModules { value: 0.123, timestamp: 1234567890, confidence: 0.85 }
[HeartPyWrapper] pushWithTimestamps called { sampleCount: 30, timestampCount: 30 }
[HeartPyWrapper] poll response { hasResult: true, bpm: 72, quality: { totalBeats: 8, goodQuality: true } }
```

### **Warm-up Phase:**
```
[PPGCamera] Received NaN sample (warm-up/low signal)
[HeartPyWrapper] Native metrics: { nativeConfidence: 0, nativeSnrDb: 0, goodQuality: false }
[PPGDisplay] HeartPy hazırlanıyor... (3/8 beat)
```

### **Peak Visualization:**
```
[HeartPyWrapper] Peak list filtering (real buffer) { originalPeaks: 5, filteredPeaks: 3, actualBufferLength: 90, relativePeaks: [15, 45, 78] }
```

## ⚠️ **Hata Durumları**

### **Sample Stream Kesilmesi:**
```
[PPGCamera] Received NaN sample (warm-up/low signal) // Sürekli NaN
[HeartPyWrapper] poll response { hasResult: false } // Sürekli false
```

### **Peak Alignment Hatası:**
```
[HeartPyWrapper] Peak list filtering (real buffer) { filteredPeaks: 0, relativePeaks: [] } // Peak'ler görünmüyor
```

## 🚀 **Test Senaryoları**

1. **Normal Ölçüm**: 30s sürekli ölçüm, BPM stabil
2. **Torch Test**: Torch aç/kapat, hızlı toparlanma
3. **Parmak Test**: Parmak kaldır/yerleştir, signal recovery
4. **Warm-up Test**: Uygulama başlatma, warm-up süreci
5. **Peak Test**: Peak çubuklarının görünürlüğü

## 📊 **Beklenen Metrikler**

- **SNR**: > 0 (warm-up sonrası)
- **Confidence**: 0 → 0.5+ (kademeli artış)
- **BPM**: 40-180 arası (stabil)
- **Peak Count**: 2-5 peak (150 sample window'da)
- **Recovery Time**: < 3s (saturasyon sonrası)

## 🤖 **Automated Acceptance Testing**

### **Log Capture**
```bash
# Capture a representative session log
react-native run-ios --simulator="iPhone 15" | tee ../artifacts/ppg_session.log

# Or capture from Metro bundler
npx react-native start | tee ../artifacts/metro_session.log
```

### **Run Acceptance Tests**
```bash
# Run the automated test suite
npm run check:ppg -- ../artifacts/ppg_session.log

# Exit codes: 0 = all tests pass, 1 = any test fails
```

### **Test Coverage**
- ✅ **Sample Stream Flow**: Valid samples, pushWithTimestamps calls
- ✅ **HeartPy Warm-up**: Native confidence preservation, BPM calculation, NaN handling
- ✅ **Peak Filtering**: Real buffer length usage, peak index calculation
- ✅ **UI Haptic Feedback**: Confidence-based gating, reliability checks
- ✅ **Error Handling**: No critical errors, graceful failure handling
- ✅ **Signal Quality**: Recovery detection, NaN ratio monitoring
- ✅ **Confidence Fallback**: Native confidence preservation logic

### **CI Integration**
```bash
# Add to pre-push hook (Husky)
npm run check:ppg -- artifacts/latest_session.log

# Add to CI pipeline
npm run check:ppg -- artifacts/ci_session.log
```
