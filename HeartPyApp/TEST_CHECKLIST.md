# 🧪 PPG App Test Checklist

## ✅ Kritik İyileştirmeler Test Edildi

### **1️⃣ UI Gating Threshold Yumuşatma**
- [ ] **Normal confidence (~0.55)** ile BPM gösteriliyor
- [ ] **Kırmızı banner** sadece gerçekten kötü sinyalde görünüyor
- [ ] **SNR > 8** threshold çalışıyor
- [ ] **goodQuality** primary gate olarak çalışıyor

### **2️⃣ Poor Signal Reset Timing**
- [ ] **Parmağı çekin** - 1s sonra reset oluyor
- [ ] **Timestamp gap > 1s** tespit ediliyor
- [ ] **Buffer + HeartPy session** reset oluyor
- [ ] **Parmağı geri koyun** - hızlı toparlanma

### **3️⃣ Peak Overlay Relative Index**
- [ ] **Peak overlay** doğru pozisyonlarda görünüyor
- [ ] **Kırmızı çubuklar** gerçek peak'lerde
- [ ] **Waveform window** ile senkronize
- [ ] **Complex mapping** kaldırıldı

### **4️⃣ FPS Tabanlı SampleRate Kalibrasyonu**
- [ ] **FPS monitoring** çalışıyor
- [ ] **SampleRate update** logları görünüyor
- [ ] **EMA smoothing** çalışıyor
- [ ] **5% threshold** çalışıyor

### **5️⃣ Analysis Window Optimizasyonu**
- [ ] **90 sample (3s)** window çalışıyor
- [ ] **Hızlı tepki** süresi
- [ ] **Düşük BPM'de** hala 2 beat yakalanıyor

## 🎯 Test Senaryoları

### **Senaryo 1: Normal Kullanım**
1. Uygulamayı aç
2. Başlat butonuna bas
3. Parmağı lens'e yerleştir
4. BPM değeri görünmeli (~0.55 confidence ile)
5. Peak overlay doğru pozisyonlarda
6. Haptik feedback çalışmalı

### **Senaryo 2: Poor Signal Detection**
1. Normal kullanım başlat
2. Parmağı çek (1s+)
3. Kırmızı banner görünmeli
4. Buffer reset olmalı
5. Parmağı geri koy
6. 1-2s içinde toparlanmalı

### **Senaryo 3: FPS Monitoring**
1. Uygulamayı başlat
2. Console'da FPS logları kontrol et
3. SampleRate update logları görünmeli
4. EMA smoothing çalışmalı

## 📊 Beklenen Sonuçlar

- **BPM Accuracy:** ±2 BPM
- **Response Time:** <3s (90 sample window)
- **Peak Overlay:** %100 doğru pozisyon
- **Poor Signal Reset:** <1s detection
- **FPS Monitoring:** 29.8-30.2 Hz range

## 🐛 Bilinen Sorunlar

- **Native taraf:** HeartPy window hala 60s (3s olmalı)
- **Native taraf:** PPGMeanPlugin confidence kalibrasyonu gerekli
- **Native taraf:** segmentRejectWindowBeats ayarlama gerekli

## ✅ Test Tamamlandı

- [ ] Tüm senaryolar test edildi
- [ ] Beklenen sonuçlar doğrulandı
- [ ] Bilinen sorunlar not edildi
- [ ] Production ready
