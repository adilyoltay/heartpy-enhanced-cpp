# HeartPy Streaming Sistem - Derin Kod İncelemesi Raporu

**Tarih:** 11 Eylül 2025  
**İncelenen Dosyalar:**
- `cpp/heartpy_stream.h` / `cpp/heartpy_stream.cpp` (streaming çekirdeği)
- `cpp/heartpy_core.h` / `cpp/heartpy_core.cpp` (çekirdek hesaplar)
- `examples/realtime_demo.cpp` (demo, PSD cadence, JSONL alanlar)
- `scripts/check_acceptance.py` (kabul asserter)
- `CMakeLists.txt` (acceptance hedefleri)

---

## 📋 Yönetici Özeti

HeartPy streaming sisteminin kapsamlı incelemesi sonucunda, **kritik**, **yüksek**, **orta** ve **düşük** öncelikli bulgular tespit edilmiştir. Sistem genel olarak iyi tasarlanmış ve acceptance kriterlerini karşılıyor olsa da, özellikle guard mantığı, harmonik bastırma zinciri ve zaman tabanı yönetiminde iyileştirmeler gerekiyor.

### Acceptance Kriterleri Durumu
- ✅ **HR:** bpm_med ≈ 72 ± 2 (warm-up 20s sonrası)
- ✅ **SNR:** snr_med ≥ 6 dB
- ✅ **Conf:** conf_med ≥ 0.6
- ✅ **Reject:** rej_med ≤ 0.1
- ✅ **ma_share:** ≥ 0.6 (20-35 bandı)
- ⚠️ **hard_frac:** ≤ 0.05 (bazı edge case'lerde risk)

---

## 🔴 KRİTİK SEVİYE BULGULAR

### 1. Çift Min-RR Gate Uygulaması ve Mantık Tekrarı

**Konum:** `heartpy_stream.cpp:230-270` ve `254-270`

**Problem:**
Min-RR gate mantığı aynı kod bloğu içinde iki kez uygulanıyor. İlk kontrol satır 230-247'de, ikinci kontrol 254-270'te gerçekleşiyor. Bu tekrar hem performans kaybına hem de potansiyel mantık hatalarına yol açabilir.

```cpp
// İlk kontrol (satır 230-247)
if (softDoublingActive_ || doublingActive_ || doublingHintActive_) {
    double longEst = 0.0;
    if (doublingLongRRms_ > 0.0) longEst = std::max(longEst, doublingLongRRms_);
    // ... median hesaplama
    double minSoft = 0.86 * longEst;
    minSoft = std::clamp(minSoft, 400.0, 1200.0);
    min_rr_ms = std::max(min_rr_ms, minSoft);
}

// Aynı koşulda ikinci kontrol (satır 254-270)  
if (softDoublingActive_ || doublingActive_ || doublingHintActive_) {
    // Tamamen aynı longEst hesaplama tekrarı
}
```

**Etki:**
- Gereksiz CPU kullanımı
- Kod maintainability sorunu
- Potansiyel farklı sonuçlar üretme riski

**Test Senaryosu:**
```bash
# Min-RR gate tutarlılığını test et
./realtime_demo 50 180 torch fast --json-out test.jsonl
# Python ile min_rr_ms değerlerindeki tutarsızlıkları analiz et
python3 -c "import json; [print(r['min_rr_ms']) for r in [json.loads(l) for l in open('test.jsonl')]]"
```

**Önerilen Çözüm:**
```cpp
// Tek bir blokta birleştir
if (softDoublingActive_ || doublingActive_ || doublingHintActive_) {
    double longEst = calculateLongRREstimate(); // Helper fonksiyon
    double minSoft = 0.86 * longEst;
    minSoft = std::clamp(minSoft, 400.0, 1200.0);
    min_rr_ms = std::max(min_rr_ms, minSoft);
    
    // Hard doubling için ek kontroller
    if (doublingActive_) {
        if (tnow <= hardFallbackUntil_ && doublingLongRRms_ > 0.0) {
            min_rr_ms = std::max(min_rr_ms, 0.9 * doublingLongRRms_);
        }
    }
}
```

---

### 2. RR-fallback Sırasında Suppression Mantık Çelişkisi

**Konum:** `heartpy_stream.cpp:821-824` ve devamı

**Problem:**
RR-fallback aktifken periodic suppression'ı atlıyor ama hemen sonrasında RR-merge yapıyor. Bu çelişkili davranış oversuppression veya undersuppression'a yol açabilir.

```cpp
// Satır 821-824
if (rrFallbackDrivingHint_) {
    // no suppression; rely on min-RR gate + refractory
} else {
    // suppression logic çalışıyor
}

// Ama satır 981-1020'de RR-merge yine de çalışıyor!
else if (rrFallbackDrivingHint_) {
    // Sınırlı merge yapılıyor ama suppression yapılmamıştı
}
```

**Etki:**
- HR acceptance kriterinde sapma (±2 BPM toleransı aşabilir)
- Tutarsız peak detection davranışı
- RR-fallback modunda güvenilmez sonuçlar

**Test Senaryosu:**
```bash
# Yüksek BPM senaryosunda RR-fallback tetikleme
# Sentetik veri ile 150 BPM civarında test
./realtime_demo 50 180 torch fast # HR parametresini 2.5 Hz'e çıkar
```

**Önerilen Çözüm:**
```cpp
// Tutarlı strateji uygula
if (rrFallbackDrivingHint_) {
    // Hem suppression hem merge OFF
    // Sadece min-RR gate + refractory'ye güven
    skipPeriodicSuppression = true;
    skipRRMerge = true;
} else if (rrFallbackActive_ && !rrFallbackDrivingHint_) {
    // Sınırlı suppression ve merge
    useConservativeSuppression = true;
    useConservativeMerge = true;
}
```

---

### 3. Timestamped Path'te Rectified Window Eksikliği

**Konum:** `heartpy_stream.cpp:424-429` (push with timestamps fonksiyonu)

**Problem:**
Timestamped veri path'inde `rollWinRect_` güncellenmesi eksik. HP-style threshold kullanıldığında timestamped path'te yanlış threshold hesaplamaları yapılabilir.

```cpp
// Satır 424-429: rollWin_ güncelleniyor ama rollWinRect_ güncellenmiyor!
rollWin_.push_back(y);
rollSum_ += y;
rollSumSq_ += static_cast<double>(y) * static_cast<double>(y);
// rollWinRect_ için güncelleme YOK - BU EKSİK!
```

**Etki:**
- Timestamped veri kullanıldığında peak detection doğruluğu bozulur
- HP-style threshold yanlış hesaplanır
- Variable frame-rate senaryolarında güvenilmez sonuçlar

**Test Senaryosu:**
```cpp
// Test kodu örneği
std::vector<float> samples = {/* ... */};
std::vector<double> timestamps = {/* variable timestamps */};
analyzer.push(samples.data(), timestamps.data(), samples.size());
// Peak detection doğruluğunu karşılaştır
```

**Önerilen Çözüm:**
```cpp
// Satır 424'ten sonra ekle:
// Rectified window update
float yr = std::max(0.0f, y);
rollWinRect_.push_back(yr);
rollRectSum_ += yr;
rollRectSumSq_ += static_cast<double>(yr) * static_cast<double>(yr);

// Trim logic de ekle
while ((int)rollWinRect_.size() > winSamples_) {
    float u = rollWinRect_.front(); 
    rollWinRect_.pop_front();
    rollRectSum_ -= u; 
    rollRectSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
}
```

---

## 🟡 YÜKSEK ÖNCELİKLİ BULGULAR

### 4. Hard-fallback Window Süresi Tutarsızlığı

**Konum:** `heartpy_stream.cpp:1279`

**Problem:**
`hardFallbackUntil_` 5 saniye olarak ayarlanıyor ancak `doublingHoldUntil_` de 5 saniye. Bu durum hard flag'in gereksiz uzun süre aktif kalmasına neden olabilir ve `hard_frac ≤ 0.05` kriterini aşma riski yaratır.

```cpp
// Satır 1279
hardFallbackUntil_ = lastTs_ + 5.0;  // Çok uzun
```

**Etki:**
- Acceptance kriteri `hard_frac ≤ 0.05` aşılabilir
- 180 saniyelik testte 9 saniyeden fazla hard flag = FAIL

**Önerilen Çözüm:**
```cpp
hardFallbackUntil_ = lastTs_ + 3.0;  // 5s yerine 3s
// veya adaptif:
double hardWindow = std::min(3.0, doublingHoldUntil_ - lastTs_);
hardFallbackUntil_ = lastTs_ + hardWindow;
```

---

### 5. PSD History Boyutu ve Drift Kontrolü

**Konum:** `heartpy_stream.cpp:1247-1249`

**Problem:**
`halfF0Hist_` sadece 3 elemanlı ve drift kontrolü çok sıkı (0.05 Hz). Bu durum geçici frekans değişimlerinde yanlış pozitif/negatif sonuçlara yol açabilir.

```cpp
// Satır 1247
if (halfF0Hist_.size() > 3) halfF0Hist_.pop_front();

// Satır 1249
halfStable = ((fmax - fmin) <= 0.05);  // Çok sıkı
```

**Etki:**
- Soft/hard doubling flag'lerinin yanlış veya geç tetiklenmesi
- HR değişimlerinde (70→75 BPM) sistem adaptasyon zorluğu

**Önerilen Çözüm:**
```cpp
// Daha robust history
if (halfF0Hist_.size() > 5) halfF0Hist_.pop_front();  // 3→5

// Daha makul drift toleransı
halfStable = ((fmax - fmin) <= 0.08);  // 0.05→0.08 Hz

// Veya adaptif tolerans
double driftTol = warmupPassed ? 0.06 : 0.10;
halfStable = ((fmax - fmin) <= driftTol);
```

---

### 6. Oversuppression Recovery Süresi Yetersizliği

**Konum:** `heartpy_stream.cpp:1293`

**Problem:**
Oversuppression (choke) tespit edildiğinde sadece 3 saniye relax süresi veriliyor. BPM < 40 durumunda bu süre recovery için yetersiz.

```cpp
// Satır 1293
chokeRelaxUntil_ = lastTs_ + 3.0;  // Yetersiz
```

**Etki:**
- Sistem oversuppression'dan çıkamayabilir
- BPM sürekli < 40'ta kalabilir
- Kullanıcı deneyimi bozulur

**Önerilen Çözüm:**
```cpp
// Daha uzun recovery
chokeRelaxUntil_ = lastTs_ + 5.0;  // 3→5 saniye

// Veya adaptif recovery
double recoveryTime = (bpmEst < 35.0) ? 7.0 : 5.0;
chokeRelaxUntil_ = lastTs_ + recoveryTime;
```

---

## 🟠 ORTA ÖNCELİKLİ BULGULAR

### 7. RR-merge İterasyon Limiti Eksikliği

**Konum:** `heartpy_stream.cpp:940-980`

**Problem:**
Aggressive RR-merge iterasyonu teorik olarak sonsuz döngüye girebilir. `removedTotal > 0.4*nInit` kontrolü var ama açık iterasyon limiti yok.

```cpp
// Satır 940
while (changed) {  // Potansiyel sonsuz döngü!
    // ...
    if (removedTotal > (size_t)(0.4 * nInit)) break;
}
```

**Önerilen Çözüm:**
```cpp
const int maxIterations = 10;
int iteration = 0;
while (changed && iteration < maxIterations) {
    // ...
    ++iteration;
}
```

---

### 8. Magic Number'lar ve Parametreleştirme

**Problem:**
Kod boyunca çok sayıda hardcoded sabit:
- `0.86` - min RR gate faktörü
- `0.75`, `1.25` - RR merge bandları
- `400.0`, `1200.0` ms - RR limitleri
- `0.24` - periodic suppression toleransı

**Önerilen Çözüm:**
```cpp
struct StreamingParams {
    // Min-RR gate parametreleri
    double minRRGateFactor = 0.86;
    double minRRFloorRelaxed = 400.0;
    double minRRFloorStrict = 500.0;
    double minRRCeiling = 1200.0;
    
    // Periodic suppression
    double periodicSuppressionTol = 0.24;
    
    // RR merge bandları
    double rrMergeBandLow = 0.75;
    double rrMergeBandHigh = 1.25;
    double rrMergeEqualBandLow = 0.85;
    double rrMergeEqualBandHigh = 1.15;
    
    // Thresholds
    double pHalfOverFundThresholdSoft = 2.0;
    double pHalfOverFundThresholdLow = 1.6;
};
```

---

### 9. SNR Band Width Değişiminin EMA'ya Etkisi

**Konum:** `heartpy_stream.cpp:1167`

**Problem:**
Active/passive durumlarda SNR band width değişiyor (0.12→0.18 Hz) ama bu ani değişim EMA hesaplamasında dikkate alınmıyor.

```cpp
double baseBw = activeSnr ? 0.18 : 0.12;  // Ani değişim
```

**Önerilen Çözüm:**
```cpp
// Band width değişiminde soft transition
if (bandWidthChanged) {
    double blendFactor = 0.3;
    snrEmaDb_ = blendFactor * snrDbInst + (1 - blendFactor) * snrEmaDb_;
}
```

---

### 10. Peak List Rebuild Verimsizliği

**Problem:**
Her peak değişiminde tüm `lastPeaks_` ve `lastRR_` yeniden hesaplanıyor. Bazı durumlarda O(n²) complexity.

**Önerilen Çözüm:**
Incremental update veya lazy evaluation stratejisi kullan.

---

## 🟢 DÜŞÜK ÖNCELİKLİ BULGULAR

### 11. Type Consistency (Double/Float Karışımı)

**Problem:**
- Signal buffer `float`
- Hesaplamalar `double`
- Gereksiz dönüşümler

**Önerilen Çözüm:**
Tutarlı `double` kullanımı veya template-based yaklaşım.

---

### 12. NaN/Inf Kontrolleri Eksikliği

**Problem:**
Division işlemlerinde NaN/Inf kontrolleri eksik.

**Önerilen Çözüm:**
```cpp
if (!std::isfinite(snrDbInst)) snrDbInst = 0.0;
if (!std::isfinite(conf)) conf = 0.0;
```

---

### 13. Kullanılmayan JSONL Alanları

**Konum:** `realtime_demo.cpp`

**Problem:**
`soft_secs` gibi alanlar export ediliyor ama acceptance script'te kullanılmıyor.

---

## 📊 ACCEPTANCE KRİTERLERİ ETKİ ANALİZİ

| Bulgu | HR (72±2) | SNR (≥6dB) | Conf (≥0.6) | Reject (≤0.1) | ma_share (≥0.6) | hard_frac (≤0.05) |
|-------|-----------|------------|-------------|---------------|-----------------|-------------------|
| #1 Min-RR Tekrarı | ⚠️ Orta | - | - | ⚠️ Orta | - | - |
| #2 RR-fallback Çelişki | 🔴 Yüksek | - | ⚠️ Orta | - | - | - |
| #3 Timestamped Path | 🔴 Yüksek | ⚠️ Orta | ⚠️ Orta | 🔴 Yüksek | - | - |
| #4 Hard-fallback Süresi | - | - | - | - | - | 🔴 Yüksek |
| #5 PSD History | ⚠️ Orta | ⚠️ Orta | ⚠️ Orta | - | - | ⚠️ Orta |
| #6 Choke Recovery | ⚠️ Orta | - | ⚠️ Orta | - | - | - |

**Lejant:**
- 🔴 Yüksek Risk: Kriteri aşma olasılığı yüksek
- ⚠️ Orta Risk: Belirli koşullarda kriteri etkileyebilir
- `-` Etki yok veya minimal

---

## 🎯 ÖNCELİKLENDİRİLMİŞ AKSIYON PLANI

### 🚨 Acil (Sprint 1 - 1 Hafta)
1. **Min-RR gate tekrarını düzelt** (#1)
   - Tahmini süre: 2 saat
   - Risk: Düşük
   - Test: Mevcut acceptance testleri

2. **Timestamped path'e rectified window ekle** (#3)
   - Tahmini süre: 4 saat
   - Risk: Orta (yeni path test edilmeli)
   - Test: Variable frame-rate testleri ekle

3. **RR-fallback suppression mantığını tutarlı yap** (#2)
   - Tahmini süre: 6 saat
   - Risk: Yüksek (davranış değişikliği)
   - Test: High BPM senaryoları

### ⚡ Yüksek Öncelik (Sprint 2 - 2 Hafta)
4. **Hard-fallback window süresini optimize et** (#4)
5. **PSD history boyutunu ve drift toleransını ayarla** (#5)
6. **chokeRelaxUntil süresini artır** (#6)

### 📋 Orta Öncelik (Sprint 3 - 3 Hafta)
7. **RR-merge iterasyon limiti ekle** (#7)
8. **Magic number'ları parametreleştir** (#8)
9. **SNR band width değişim handling'i** (#9)

### 📦 Düşük Öncelik (Backlog)
10. Performans optimizasyonları
11. Type consistency (double/float)
12. NaN/Inf kontrolleri
13. JSONL alan temizliği

---

## ✅ TEST STRATEJİSİ

### Regresyon Test Suite

```bash
#!/bin/bash
# test_acceptance.sh

# Temel acceptance testleri
echo "=== Temel Acceptance Testleri ==="
./build-mac/realtime_demo 50 180 torch fast --json-out torch_base.jsonl
./build-mac/realtime_demo 50 180 ambient fast --json-out ambient_base.jsonl
python3 scripts/check_acceptance.py --build-dir build-mac --preset both

# Edge case testleri
echo "=== Edge Case Testleri ==="

# Düşük sample rate
./build-mac/realtime_demo 30 180 torch fast --json-out torch_30hz.jsonl

# Yüksek sample rate  
./build-mac/realtime_demo 100 180 torch fast --json-out torch_100hz.jsonl

# Kısa pencere
./build-mac/realtime_demo 50 60 torch fast --json-out torch_60s.jsonl

# Uzun pencere
./build-mac/realtime_demo 50 300 torch fast --json-out torch_300s.jsonl
```

### Performans Profiling

```bash
# CPU profiling
time ./build-mac/realtime_demo 50 180 torch fast --json-out /dev/null

# Memory profiling (macOS)
leaks --atExit -- ./build-mac/realtime_demo 50 60 torch fast

# Valgrind (Linux)
valgrind --tool=callgrind ./build-mac/realtime_demo 50 180 torch fast
valgrind --leak-check=full ./build-mac/realtime_demo 50 60 torch fast
```

### Continuous Integration

```yaml
# .github/workflows/acceptance.yml
name: Acceptance Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        preset: [torch, ambient]
        duration: [60, 180]
    steps:
      - uses: actions/checkout@v2
      - name: Build
        run: |
          cmake -S . -B build
          cmake --build build
      - name: Run Acceptance
        run: |
          python3 scripts/check_acceptance.py \
            --build-dir build \
            --preset ${{ matrix.preset }} \
            --duration ${{ matrix.duration }}
```

---

## 📈 METRİKLER VE MONİTÖRİNG

### Önerilen Telemetri

```cpp
struct StreamingTelemetry {
    // Performance
    double avgProcessTimeMs;
    double maxProcessTimeMs;
    size_t totalSamplesProcessed;
    
    // Accuracy
    size_t peaksDetected;
    size_t peaksRejected;
    double avgConfidence;
    
    // Flags
    size_t softDoublingActivations;
    size_t hardDoublingActivations;
    size_t rrFallbackActivations;
    
    // Errors
    size_t oversuppressionEvents;
    size_t undersuppressionEvents;
    size_t nanInfEvents;
};
```

---

## 🏁 SONUÇ VE ÖNERİLER

### Güçlü Yönler
✅ İyi yapılandırılmış guard chain  
✅ Kapsamlı harmonic suppression  
✅ Adaptif threshold mekanizması  
✅ Robust SNR/confidence mapping  
✅ Acceptance kriterleri genel olarak sağlanıyor  

### İyileştirme Alanları
⚠️ Kod tekrarları ve verimsizlikler  
⚠️ Edge case handling  
⚠️ Parametreleştirme eksikliği  
⚠️ Test coverage  

### Kritik Öneri
**Production deployment öncesi mutlaka #1, #2, #3 numaralı kritik bulguların çözülmesi gerekiyor.** Bu bulgular düzeltilmeden sistem edge case'lerde güvenilmez sonuçlar üretebilir.

### Uzun Vadeli Öneriler
1. **Modülerleştirme:** Guard logic, suppression chain, RR processing ayrı modüllere taşınmalı
2. **Konfigürasyon:** Runtime configurable parametreler için JSON/YAML config desteği
3. **Telemetri:** Production monitoring için comprehensive metrics
4. **Test Coverage:** %80+ code coverage hedefi
5. **Documentation:** Inline documentation ve algorithm açıklamaları

---

## 📚 REFERANSLAR

- HeartPy Python Implementation: [github.com/paulvangentcom/heartrate_analysis_python](https://github.com/paulvangentcom/heartrate_analysis_python)
- PPG Signal Processing Best Practices
- Real-time DSP Optimization Techniques
- MIT-BIH Arrhythmia Database Validation Standards

---

**Doküman Sonu**  
*Bu rapor, HeartPy streaming sisteminin v1.0 kod tabanı üzerinde yapılan incelemeyi yansıtmaktadır.*
