# 🔥 Signal Optimization Guide

## 📱 **Fiziksel Optimizasyon Talimatları**

### **1. Torch ve Pozisyon Ayarları:**
- **Torch Seviyesi:** Artık maksimum (1.0) - cihazda manuel olarak "yüksek" seviyeye çekin
- **Parmak Pozisyonu:** 
  - Parmak ucunu lens + flash üzerine **tam kaplayın**
  - Hafif baskı uygulayın (çok sert değil)
  - Parmak titremesini önlemek için cihazı **masa üzerine koyun**
- **ROI:** Daha odaklanmış (0.2) - parmağın merkezini hedefleyin

### **2. Test Süreci:**
1. **Uygulamayı başlatın**
2. **30+ saniye** sabit pozisyonda tutun
3. **Metro loglarını izleyin:**
   - `PPGPlugin` loglarında `confidenceOut > 0.1` görmeye çalışın
   - `nativeConfidence: 0` → `nativeConfidence: 0.3-0.6` geçişini bekleyin
   - `nativeSnrDb: 0` → `nativeSnrDb > 0` geçişini bekleyin

### **3. Beklenen Sonuçlar:**
- **Warm-up:** 4 beat ile daha hızlı hazırlık
- **Confidence:** 0.2+ threshold ile daha kolay geçiş
- **SNR:** 2+ dB threshold ile daha toleranslı
- **BPM:** Daha erken görünür hale gelir

### **4. Sorun Giderme:**
- **Hâlâ confidence 0:** Parmak pozisyonunu değiştirin, daha fazla baskı uygulayın
- **Titreme:** Cihazı masa üzerine koyun, dirsek desteği kullanın
- **Yetersiz ışık:** Ortam ışığını azaltın, torch'un tam açık olduğundan emin olun

## 🔧 **Teknik Optimizasyonlar**

### **Yapılan Değişiklikler:**
- **Torch Level:** 0.3 → 1.0 (maksimum parlaklık)
- **ROI:** 0.5 → 0.2 (daha odaklanmış)
- **Analysis Window:** 90 → 150 samples (5s stabil analiz)
- **Bandpass:** 0.5-3.5Hz → 0.4-4.0Hz (daha geniş)
- **RefractoryMs:** 280ms → 200ms (daha hassas)
- **Min Beats:** 8 → 4 (daha hızlı warm-up)
- **Confidence Threshold:** 0.6 → 0.2 (daha toleranslı)
- **SNR Threshold:** 8dB → 2dB (daha toleranslı)

### **Test Komutu:**
```bash
npm run check:ppg -- ../artifacts/new_session.log
```

## 📊 **Başarı Kriterleri:**
- ✅ `nativeConfidence > 0.1`
- ✅ `nativeSnrDb > 0`
- ✅ `filteredPeaks > 0`
- ✅ BPM görünür hale gelir
- ✅ Haptic feedback çalışır
