#include <jni.h>
#include <vector>
#include <algorithm>
#include <sstream>
#include <string>
#include <android/log.h>
#include <unordered_map>
#include <mutex>
#include <atomic>
#include <cstdint>
#include <jsi/jsi.h>
#include "../../../../cpp/heartpy_core.h"
// Realtime streaming API
#include "../../../../cpp/heartpy_stream.h"
// RN options validator (step 1)
#include "../../cpp/rn_options_builder.h"

static std::string to_json(const heartpy::HeartMetrics& r, bool includeSegments=false) {
    std::ostringstream os;
    os << "{";
    auto arr = [&](const char* k, const std::vector<double>& v){
        os << "\"" << k << "\":" << "[";
        for (size_t i=0;i<v.size();++i){ if(i) os << ","; os << v[i]; }
        os << "]";
    };
    auto arr_i = [&](const char* k, const std::vector<int>& v){
        os << "\"" << k << "\":" << "[";
        for (size_t i=0;i<v.size();++i){ if(i) os << ","; os << v[i]; }
        os << "]";
    };
    auto kv = [&](const char* k, double v){ os << "\""<<k<<"\":"<<v; };
    // scalars
    kv("bpm", r.bpm); os << ",";
    kv("sdnn", r.sdnn); os << ","; kv("rmssd", r.rmssd); os << ","; kv("sdsd", r.sdsd); os << ",";
    kv("pnn20", r.pnn20); os << ","; kv("pnn50", r.pnn50); os << ","; kv("nn20", r.nn20); os << ","; kv("nn50", r.nn50); os << ","; kv("mad", r.mad); os << ",";
    kv("sd1", r.sd1); os << ","; kv("sd2", r.sd2); os << ","; kv("sd1sd2Ratio", r.sd1sd2Ratio); os << ","; kv("ellipseArea", r.ellipseArea); os << ",";
    kv("vlf", r.vlf); os << ","; kv("lf", r.lf); os << ","; kv("hf", r.hf); os << ","; kv("lfhf", r.lfhf); os << ","; kv("totalPower", r.totalPower); os << ","; kv("lfNorm", r.lfNorm); os << ","; kv("hfNorm", r.hfNorm); os << ",";
    kv("breathingRate", r.breathingRate); os << ",";
    // arrays
    arr("ibiMs", r.ibiMs); os << ","; arr("rrList", r.rrList); os << ","; arr_i("peakList", r.peakList); os << ",";
    arr_i("peakListRaw", r.peakListRaw); os << ",";
    arr_i("binaryPeakMask", r.binaryPeakMask); os << ",";
    // quality
    os << "\"quality\":{";
    kv("totalBeats", r.quality.totalBeats); os << ","; kv("rejectedBeats", r.quality.rejectedBeats); os << ","; kv("rejectionRate", r.quality.rejectionRate); os << ",";
    os << "\"goodQuality\":" << (r.quality.goodQuality ? "true" : "false");
    // Streaming metrics (if available)
    os << ",\"snrDb\":" << r.quality.snrDb;
    os << ",\"confidence\":" << r.quality.confidence;
    os << ",\"f0Hz\":" << r.quality.f0Hz;
    os << ",\"maPercActive\":" << r.quality.maPercActive;
    os << ",\"doublingFlag\":" << r.quality.doublingFlag;
    os << ",\"softDoublingFlag\":" << r.quality.softDoublingFlag;
    os << ",\"doublingHintFlag\":" << r.quality.doublingHintFlag;
    os << ",\"hardFallbackActive\":" << r.quality.hardFallbackActive;
    os << ",\"rrFallbackModeActive\":" << r.quality.rrFallbackModeActive;
    os << ",\"refractoryMsActive\":" << r.quality.refractoryMsActive;
    os << ",\"minRRBoundMs\":" << r.quality.minRRBoundMs;
    os << ",\"pairFrac\":" << r.quality.pairFrac;
    os << ",\"rrShortFrac\":" << r.quality.rrShortFrac;
    os << ",\"rrLongMs\":" << r.quality.rrLongMs;
    os << ",\"pHalfOverFund\":" << r.quality.pHalfOverFund;
    if (!r.quality.qualityWarning.empty()) {
        os << ",\"qualityWarning\":\"";
        // naive string escape for quotes/backslashes
        for (char c : r.quality.qualityWarning) { if (c=='"' || c=='\\') os << '\\'; os << c; }
        os << "\"";
    }
    os << "}";
    // binary segments
    os << ",\"binarySegments\":[";
    for (size_t i=0;i<r.binarySegments.size();++i){
        if(i) os << ",";
        const auto &bs = r.binarySegments[i];
        os << "{"
           << "\"index\":" << bs.index << ","
           << "\"startBeat\":" << bs.startBeat << ","
           << "\"endBeat\":" << bs.endBeat << ","
           << "\"totalBeats\":" << bs.totalBeats << ","
           << "\"rejectedBeats\":" << bs.rejectedBeats << ","
           << "\"accepted\":" << (bs.accepted?"true":"false")
           << "}";
    }
    os << "]";
    if (includeSegments) {
        os << ",\"segments\":[";
        for (size_t i=0;i<r.segments.size();++i){ if(i) os << ","; os << to_json(r.segments[i], false); }
        os << "]";
    }
    os << "}";
    return os.str();
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_heartpy_HeartPyModule_analyzeNativeJson(
        JNIEnv* env,
        jclass,
        jdoubleArray jSignal,
        jdouble fs,
        jdouble lowHz,
        jdouble highHz,
        jint order,
        jint nfft,
        jdouble overlap,
        jdouble welchWsizeSec,
        jdouble refractoryMs,
        jdouble thresholdScale,
        jdouble bpmMin,
        jdouble bpmMax,
        jboolean interpClipping,
        jdouble clippingThreshold,
        jboolean hampelCorrect,
        jint hampelWindow,
        jdouble hampelThreshold,
        jboolean removeBaselineWander,
        jboolean enhancePeaks,
        jboolean highPrecision,
        jdouble highPrecisionFs,
        jboolean rejectSegmentwise,
        jdouble segmentRejectThreshold,
        jint segmentRejectMaxRejects,
        jint segmentRejectWindowBeats,
        jdouble segmentRejectOverlap,
        jboolean cleanRR,
        jint cleanMethod,
        jdouble segmentWidth,
        jdouble segmentOverlap,
        jdouble segmentMinSize,
        jboolean replaceOutliers,
        jdouble rrSplineS,
        jdouble rrSplineTargetSse,
        jdouble rrSplineSmooth,
        jboolean breathingAsBpm,
        jint sdsdMode,
        jint poincareMode,
        jboolean pnnAsPercent) {
    jsize len = env->GetArrayLength(jSignal);
    std::vector<double> signal(len);
    env->GetDoubleArrayRegion(jSignal, 0, len, signal.data());

    heartpy::Options opt;
    opt.lowHz = lowHz; opt.highHz = highHz; opt.iirOrder = order;
    opt.nfft = nfft; opt.overlap = overlap; opt.welchWsizeSec = welchWsizeSec;
    opt.refractoryMs = refractoryMs; opt.thresholdScale = thresholdScale; opt.bpmMin = bpmMin; opt.bpmMax = bpmMax;
    opt.interpClipping = interpClipping; opt.clippingThreshold = clippingThreshold;
    opt.hampelCorrect = hampelCorrect; opt.hampelWindow = hampelWindow; opt.hampelThreshold = hampelThreshold;
    opt.removeBaselineWander = removeBaselineWander; opt.enhancePeaks = enhancePeaks;
    opt.highPrecision = highPrecision; opt.highPrecisionFs = highPrecisionFs;
    opt.rejectSegmentwise = rejectSegmentwise; opt.segmentRejectThreshold = segmentRejectThreshold; opt.segmentRejectMaxRejects = segmentRejectMaxRejects;
    opt.segmentRejectWindowBeats = segmentRejectWindowBeats; opt.segmentRejectOverlap = segmentRejectOverlap;
    opt.cleanRR = cleanRR; opt.cleanMethod = (cleanMethod==1? heartpy::Options::CleanMethod::IQR : (cleanMethod==2? heartpy::Options::CleanMethod::Z_SCORE : heartpy::Options::CleanMethod::QUOTIENT_FILTER));
    opt.segmentWidth = segmentWidth; opt.segmentOverlap = segmentOverlap; opt.segmentMinSize = segmentMinSize; opt.replaceOutliers = replaceOutliers;
    opt.rrSplineS = rrSplineS; opt.rrSplineSTargetSse = rrSplineTargetSse; opt.rrSplineSmooth = rrSplineSmooth;
    opt.breathingAsBpm = breathingAsBpm;
    opt.sdsdMode = (sdsdMode==0 ? heartpy::Options::SdsdMode::SIGNED : heartpy::Options::SdsdMode::ABS);
    opt.poincareMode = (poincareMode==1 ? heartpy::Options::PoincareMode::MASKED : heartpy::Options::PoincareMode::FORMULA);
    opt.pnnAsPercent = (pnnAsPercent==JNI_TRUE);

    auto res = heartpy::analyzeSignal(signal, fs, opt);
    std::string json = to_json(res, false);
    return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_heartpy_HeartPyModule_analyzeRRNativeJson(
        JNIEnv* env,
        jclass,
        jdoubleArray jRR,
        jboolean cleanRR,
        jint cleanMethod,
        jboolean breathingAsBpm,
        jboolean thresholdRR,
        jint sdsdMode,
        jint poincareMode,
        jboolean pnnAsPercent) {
    jsize len = env->GetArrayLength(jRR);
    std::vector<double> rr(len);
    env->GetDoubleArrayRegion(jRR, 0, len, rr.data());
    heartpy::Options opt;
    opt.cleanRR = cleanRR; opt.cleanMethod = (cleanMethod==1? heartpy::Options::CleanMethod::IQR : (cleanMethod==2? heartpy::Options::CleanMethod::Z_SCORE : heartpy::Options::CleanMethod::QUOTIENT_FILTER));
    opt.breathingAsBpm = breathingAsBpm;
    opt.thresholdRR = (thresholdRR==JNI_TRUE);
    opt.sdsdMode = (sdsdMode==0 ? heartpy::Options::SdsdMode::SIGNED : heartpy::Options::SdsdMode::ABS);
    opt.poincareMode = (poincareMode==1 ? heartpy::Options::PoincareMode::MASKED : heartpy::Options::PoincareMode::FORMULA);
    opt.pnnAsPercent = (pnnAsPercent==JNI_TRUE);
    auto res = heartpy::analyzeRRIntervals(rr, opt);
    std::string json = to_json(res, false);
    return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_heartpy_HeartPyModule_analyzeSegmentwiseNativeJson(
        JNIEnv* env,
        jclass,
        jdoubleArray jSignal,
        jdouble fs,
        jdouble lowHz,
        jdouble highHz,
        jint order,
        jint nfft,
        jdouble overlap,
        jdouble welchWsizeSec,
        jdouble refractoryMs,
        jdouble thresholdScale,
        jdouble bpmMin,
        jdouble bpmMax,
        jboolean interpClipping,
        jdouble clippingThreshold,
        jboolean hampelCorrect,
        jint hampelWindow,
        jdouble hampelThreshold,
        jboolean removeBaselineWander,
        jboolean enhancePeaks,
        jboolean highPrecision,
        jdouble highPrecisionFs,
        jboolean rejectSegmentwise,
        jdouble segmentRejectThreshold,
        jint segmentRejectMaxRejects,
        jint segmentRejectWindowBeats,
        jdouble segmentRejectOverlap,
        jboolean cleanRR,
        jint cleanMethod,
        jdouble segmentWidth,
        jdouble segmentOverlap,
        jdouble segmentMinSize,
        jboolean replaceOutliers,
        jdouble rrSplineS,
        jdouble rrSplineTargetSse,
        jdouble rrSplineSmooth,
        jboolean breathingAsBpm,
        jint sdsdMode,
        jint poincareMode,
        jboolean pnnAsPercent) {
    jsize len = env->GetArrayLength(jSignal);
    std::vector<double> signal(len);
    env->GetDoubleArrayRegion(jSignal, 0, len, signal.data());
    heartpy::Options opt;
    opt.lowHz = lowHz; opt.highHz = highHz; opt.iirOrder = order;
    opt.nfft = nfft; opt.overlap = overlap; opt.welchWsizeSec = welchWsizeSec;
    opt.refractoryMs = refractoryMs; opt.thresholdScale = thresholdScale; opt.bpmMin = bpmMin; opt.bpmMax = bpmMax;
    opt.interpClipping = interpClipping; opt.clippingThreshold = clippingThreshold;
    opt.hampelCorrect = hampelCorrect; opt.hampelWindow = hampelWindow; opt.hampelThreshold = hampelThreshold;
    opt.removeBaselineWander = removeBaselineWander; opt.enhancePeaks = enhancePeaks;
    opt.highPrecision = highPrecision; opt.highPrecisionFs = highPrecisionFs;
    opt.rejectSegmentwise = rejectSegmentwise; opt.segmentRejectThreshold = segmentRejectThreshold; opt.segmentRejectMaxRejects = segmentRejectMaxRejects; opt.segmentRejectWindowBeats = segmentRejectWindowBeats;
    opt.cleanRR = cleanRR; opt.cleanMethod = (cleanMethod==1? heartpy::Options::CleanMethod::IQR : (cleanMethod==2? heartpy::Options::CleanMethod::Z_SCORE : heartpy::Options::CleanMethod::QUOTIENT_FILTER));
    opt.segmentWidth = segmentWidth; opt.segmentOverlap = segmentOverlap; opt.segmentMinSize = segmentMinSize; opt.replaceOutliers = replaceOutliers;
    opt.rrSplineS = rrSplineS; opt.rrSplineSTargetSse = rrSplineTargetSse; opt.rrSplineSmooth = rrSplineSmooth;
    opt.breathingAsBpm = breathingAsBpm;
    opt.sdsdMode = (sdsdMode==0 ? heartpy::Options::SdsdMode::SIGNED : heartpy::Options::SdsdMode::ABS);
    opt.poincareMode = (poincareMode==1 ? heartpy::Options::PoincareMode::MASKED : heartpy::Options::PoincareMode::FORMULA);
    opt.pnnAsPercent = (pnnAsPercent==JNI_TRUE);
    auto res = heartpy::analyzeSignalSegmentwise(signal, fs, opt);
    std::string json = to_json(res, true);
    return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_heartpy_HeartPyModule_interpolateClippingNative(JNIEnv* env, jclass, jdoubleArray jSignal, jdouble fs, jdouble threshold) {
    jsize len = env->GetArrayLength(jSignal);
    std::vector<double> signal(len);
    env->GetDoubleArrayRegion(jSignal, 0, len, signal.data());
    auto y = heartpy::interpolateClipping(signal, fs, threshold);
    jdoubleArray out = env->NewDoubleArray((jsize)y.size());
    if (!y.empty()) env->SetDoubleArrayRegion(out, 0, (jsize)y.size(), y.data());
    return out;
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_heartpy_HeartPyModule_hampelFilterNative(JNIEnv* env, jclass, jdoubleArray jSignal, jint windowSize, jdouble threshold) {
    jsize len = env->GetArrayLength(jSignal);
    std::vector<double> signal(len);
    env->GetDoubleArrayRegion(jSignal, 0, len, signal.data());
    auto y = heartpy::hampelFilter(signal, windowSize, threshold);
    jdoubleArray out = env->NewDoubleArray((jsize)y.size());
    if (!y.empty()) env->SetDoubleArrayRegion(out, 0, (jsize)y.size(), y.data());
    return out;
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_heartpy_HeartPyModule_scaleDataNative(JNIEnv* env, jclass, jdoubleArray jSignal, jdouble newMin, jdouble newMax) {
    jsize len = env->GetArrayLength(jSignal);
    std::vector<double> signal(len);
    env->GetDoubleArrayRegion(jSignal, 0, len, signal.data());
    auto y = heartpy::scaleData(signal, newMin, newMax);
    jdoubleArray out = env->NewDoubleArray((jsize)y.size());
    if (!y.empty()) env->SetDoubleArrayRegion(out, 0, (jsize)y.size(), y.data());
    return out;
}

// ------------------------------
// Realtime Streaming JNI (P0)
// ------------------------------

extern "C" JNIEXPORT jlong JNICALL
Java_com_heartpy_HeartPyModule_rtCreateNative(
        JNIEnv* env,
        jclass,
        jdouble fs,
        jdouble lowHz,
        jdouble highHz,
        jint order,
        jint nfft,
        jdouble overlap,
        jdouble welchWsizeSec,
        jdouble refractoryMs,
        jdouble thresholdScale,
        jdouble bpmMin,
        jdouble bpmMax,
        jboolean interpClipping,
        jdouble clippingThreshold,
        jboolean hampelCorrect,
        jint hampelWindow,
        jdouble hampelThreshold,
        jboolean removeBaselineWander,
        jboolean enhancePeaks,
        jboolean highPrecision,
        jdouble highPrecisionFs,
        jboolean rejectSegmentwise,
        jdouble segmentRejectThreshold,
        jint segmentRejectMaxRejects,
        jint segmentRejectWindowBeats,
        jdouble segmentRejectOverlap,
        jboolean cleanRR,
        jint cleanMethod,
        jdouble segmentWidth,
        jdouble segmentOverlap,
        jdouble segmentMinSize,
        jboolean replaceOutliers,
        jdouble rrSplineS,
        jdouble rrSplineTargetSse,
        jdouble rrSplineSmooth,
        jboolean breathingAsBpm,
        jint sdsdMode,
        jint poincareMode,
        jboolean pnnAsPercent) {
    heartpy::Options opt;
    opt.lowHz = lowHz; opt.highHz = highHz; opt.iirOrder = order;
    opt.nfft = nfft; opt.overlap = overlap; opt.welchWsizeSec = welchWsizeSec;
    opt.refractoryMs = refractoryMs; opt.thresholdScale = thresholdScale; opt.bpmMin = bpmMin; opt.bpmMax = bpmMax;
    opt.interpClipping = interpClipping; opt.clippingThreshold = clippingThreshold;
    opt.hampelCorrect = hampelCorrect; opt.hampelWindow = hampelWindow; opt.hampelThreshold = hampelThreshold;
    opt.removeBaselineWander = removeBaselineWander; opt.enhancePeaks = enhancePeaks;
    opt.highPrecision = highPrecision; opt.highPrecisionFs = highPrecisionFs;
    opt.rejectSegmentwise = rejectSegmentwise; opt.segmentRejectThreshold = segmentRejectThreshold; opt.segmentRejectMaxRejects = segmentRejectMaxRejects; opt.segmentRejectWindowBeats = segmentRejectWindowBeats; opt.segmentRejectOverlap = segmentRejectOverlap;
    opt.cleanRR = cleanRR; opt.cleanMethod = (cleanMethod==1? heartpy::Options::CleanMethod::IQR : (cleanMethod==2? heartpy::Options::CleanMethod::Z_SCORE : heartpy::Options::CleanMethod::QUOTIENT_FILTER));
    opt.segmentWidth = segmentWidth; opt.segmentOverlap = segmentOverlap; opt.segmentMinSize = segmentMinSize; opt.replaceOutliers = replaceOutliers;
    opt.rrSplineS = rrSplineS; opt.rrSplineSTargetSse = rrSplineTargetSse; opt.rrSplineSmooth = rrSplineSmooth;
    opt.breathingAsBpm = breathingAsBpm;
    opt.sdsdMode = (sdsdMode==0 ? heartpy::Options::SdsdMode::SIGNED : heartpy::Options::SdsdMode::ABS);
    opt.poincareMode = (poincareMode==1 ? heartpy::Options::PoincareMode::MASKED : heartpy::Options::PoincareMode::FORMULA);
    opt.pnnAsPercent = (pnnAsPercent==JNI_TRUE);
    void* h = hp_rt_create(fs, &opt);
    return (jlong)h;
}

extern "C" JNIEXPORT void JNICALL
Java_com_heartpy_HeartPyModule_rtPushNative(JNIEnv* env, jclass, jlong h, jdoubleArray jData, jdouble t0) {
    if (!h || !jData) return;
    jsize len = env->GetArrayLength(jData);
    if (len <= 0) return;
    std::vector<double> tmp(len);
    env->GetDoubleArrayRegion(jData, 0, len, tmp.data());
    std::vector<float> x(len);
    for (jsize i = 0; i < len; ++i) x[i] = static_cast<float>(tmp[i]);
    hp_rt_push((void*)h, x.data(), (size_t)x.size(), t0);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_heartpy_HeartPyModule_rtPollNative(JNIEnv* env, jclass, jlong h) {
    if (!h) return nullptr;
    heartpy::HeartMetrics out;
    if (!hp_rt_poll((void*)h, &out)) return nullptr;
    std::string json = to_json(out, false);
    return env->NewStringUTF(json.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_heartpy_HeartPyModule_rtDestroyNative(JNIEnv* env, jclass, jlong h) {
    if (!h) return;
    hp_rt_destroy((void*)h);
}

// Validator JNI: returns error code string on failure, or null on success
extern "C" JNIEXPORT jstring JNICALL
Java_com_heartpy_HeartPyModule_rtValidateOptionsNative(
        JNIEnv* env,
        jclass,
        jdouble fs,
        jdouble lowHz,
        jdouble highHz,
        jint order,
        jint nfft,
        jdouble overlap,
        jdouble welchWsizeSec,
        jdouble refractoryMs,
        jdouble bpmMin,
        jdouble bpmMax,
        jdouble highPrecisionFs) {
    heartpy::Options opt;
    opt.lowHz = lowHz; opt.highHz = highHz; opt.iirOrder = order;
    opt.nfft = nfft; opt.overlap = overlap; opt.welchWsizeSec = welchWsizeSec;
    opt.refractoryMs = refractoryMs; opt.bpmMin = bpmMin; opt.bpmMax = bpmMax;
    opt.highPrecisionFs = highPrecisionFs;
    const char* code = nullptr; std::string msg;
    if (!hp_validate_options(fs, opt, &code, &msg)) {
        if (code) return env->NewStringUTF(code);
        return env->NewStringUTF("HEARTPY_E015");
    }
    return nullptr;
}

// ------------------------------
// Android JSI install + host functions
// ------------------------------

// Forward declare installer
static void installBinding(facebook::jsi::Runtime& rt);

extern "C" JNIEXPORT void JNICALL
Java_com_heartpy_HeartPyModule_installJSIHybrid(JNIEnv*, jclass, jlong runtimePtr) {
    if (runtimePtr == 0) return;
    auto* runtime = reinterpret_cast<facebook::jsi::Runtime*>(runtimePtr);
    installBinding(*runtime);
}

// Handle registry for JSI path (32-bit IDs)
static std::unordered_map<uint32_t, void*> g_handles;
static std::mutex g_handles_m;
static std::atomic<uint32_t> g_next_id{1};

static uint32_t hp_handle_register(void* p) {
    std::lock_guard<std::mutex> lock(g_handles_m);
    uint32_t id = g_next_id.fetch_add(1);
    g_handles[id] = p;
    return id;
}
static void* hp_handle_get(uint32_t id) {
    std::lock_guard<std::mutex> lock(g_handles_m);
    auto it = g_handles.find(id);
    return (it == g_handles.end() ? nullptr : it->second);
}
static void hp_handle_remove(uint32_t id) {
    std::lock_guard<std::mutex> lock(g_handles_m);
    auto it = g_handles.find(id);
    if (it != g_handles.end()) {
        void* p = it->second;
        g_handles.erase(it);
        hp_rt_destroy(p);
    }
}

// Zero-copy flag (updated from Java setConfig)
static std::atomic<bool> g_zero_copy_enabled{true};

extern "C" JNIEXPORT void JNICALL
Java_com_heartpy_HeartPyModule_setZeroCopyEnabledNative(JNIEnv*, jclass, jboolean enabled) {
    g_zero_copy_enabled.store(enabled == JNI_TRUE);
}

static void installBinding(facebook::jsi::Runtime& rt) {
    using namespace facebook::jsi;
    // __hpRtCreate(fs:number, options?:object) -> number (id)
    auto fnCreate = Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "__hpRtCreate"),
        2,
        [](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
            if (count < 1 || !args[0].isNumber()) {
                throw JSError(rt, "HEARTPY_E001: invalid fs");
            }
            double fs = args[0].asNumber();
            heartpy::Options opt;
            if (count > 1 && args[1].isObject()) {
                opt = hp_build_options_from_jsi(rt, args[1].asObject(rt), nullptr, nullptr);
            }
            const char* code = nullptr; std::string msg;
            if (!hp_validate_options(fs, opt, &code, &msg)) {
                std::string m = (code ? code : "HEARTPY_E015"); m += ": "; m += msg;
                throw JSError(rt, m.c_str());
            }
            void* p = hp_rt_create(fs, &opt);
            if (!p) throw JSError(rt, "HEARTPY_E004: create failed");
            uint32_t id = hp_handle_register(p);
            return Value((double)id);
        }
    );
    rt.global().setProperty(rt, "__hpRtCreate", fnCreate);

    // __hpRtPush(handle:number, data:Float32Array, t0?:number) -> void
    auto fnPush = Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "__hpRtPush"),
        3,
        [](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
            if (count < 2) throw JSError(rt, "HEARTPY_E102: missing data");
            if (!args[0].isNumber()) throw JSError(rt, "HEARTPY_E101: invalid handle");
            uint32_t id = (uint32_t)args[0].asNumber();
            void* p = hp_handle_get(id);
            if (!p) throw JSError(rt, "HEARTPY_E101: invalid handle");
            auto arr = args[1];
            if (!arr.isObject()) throw JSError(rt, "HEARTPY_E102: invalid buffer");
            auto o = arr.asObject(rt);
            size_t len = (size_t)o.getProperty(rt, "length").asNumber();
            if (len == 0) throw JSError(rt, "HEARTPY_E102: empty buffer");
            double t0 = (count > 2 && args[2].isNumber()) ? args[2].asNumber() : 0.0;
            const size_t MAX_SAMPLES_PER_PUSH = 5000;
            if (len > MAX_SAMPLES_PER_PUSH) throw JSError(rt, "HEARTPY_E102: buffer too large");

            bool usedZeroCopy = false;
            if (g_zero_copy_enabled.load()) {
                try {
                    size_t bpe = (size_t)o.getProperty(rt, "BYTES_PER_ELEMENT").asNumber();
                    size_t byteOffset = (size_t)o.getProperty(rt, "byteOffset").asNumber();
                    auto buf = o.getProperty(rt, "buffer").asObject(rt);
                    auto ab = buf.getArrayBuffer(rt);
                    uint8_t* base = ab.data(rt);
                    size_t abSize = ab.size(rt);
                    size_t need = byteOffset + len * bpe;
                    if (bpe == 4 && base && need <= abSize && (byteOffset % 4 == 0)) {
                        float* data = reinterpret_cast<float*>(base + byteOffset);
                        hp_rt_push(p, data, len, t0);
                        usedZeroCopy = true;
                        __android_log_print(ANDROID_LOG_DEBUG, "HeartPyJSI", "rtPush: zero-copy used (len=%zu)", len);
                    }
                } catch (...) {
                    // fall through to copy path
                }
            }
            if (!usedZeroCopy) {
                __android_log_print(ANDROID_LOG_DEBUG, "HeartPyJSI", "rtPush: fallback copy path (len=%zu)", len);
                std::vector<float> tmp; tmp.reserve(len);
                for (size_t i = 0; i < len; ++i) tmp.push_back((float)o.getPropertyAtIndex(rt, (uint32_t)i).asNumber());
                hp_rt_push(p, tmp.data(), tmp.size(), t0);
            }
            return Value::undefined();
        }
    );
    rt.global().setProperty(rt, "__hpRtPush", fnPush);

    // __hpRtPoll(handle:number) -> object | null
    auto fnPoll = Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "__hpRtPoll"),
        1,
        [](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
            if (count < 1 || !args[0].isNumber()) throw JSError(rt, "HEARTPY_E111: invalid handle");
            uint32_t id = (uint32_t)args[0].asNumber();
            void* p = hp_handle_get(id);
            if (!p) throw JSError(rt, "HEARTPY_E111: invalid handle");
            heartpy::HeartMetrics out;
            if (!hp_rt_poll(p, &out)) return Value::null();
            Object obj(rt);
            obj.setProperty(rt, "bpm", out.bpm);
            // rrList
            {
                Array rr(rt, out.rrList.size());
                for (size_t i=0;i<out.rrList.size();++i) rr.setValueAtIndex(rt, i, out.rrList[i]);
                obj.setProperty(rt, "rrList", rr);
            }
            // quality
            {
                Object q(rt);
                q.setProperty(rt, "snrDb", out.quality.snrDb);
                q.setProperty(rt, "confidence", out.quality.confidence);
                obj.setProperty(rt, "quality", q);
            }
            return obj;
        }
    );
    rt.global().setProperty(rt, "__hpRtPoll", fnPoll);

    // __hpRtDestroy(handle:number)
    auto fnDestroy = Function::createFromHostFunction(
        rt,
        PropNameID::forAscii(rt, "__hpRtDestroy"),
        1,
        [](Runtime& rt, const Value&, const Value* args, size_t count) -> Value {
            if (count < 1 || !args[0].isNumber()) throw JSError(rt, "HEARTPY_E121: invalid handle");
            uint32_t id = (uint32_t)args[0].asNumber();
            hp_handle_remove(id);
            return Value::undefined();
        }
    );
    rt.global().setProperty(rt, "__hpRtDestroy", fnDestroy);
}


