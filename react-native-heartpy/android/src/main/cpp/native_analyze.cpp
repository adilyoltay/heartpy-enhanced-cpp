#include <jni.h>
#include <vector>
#include <algorithm>
#include <sstream>
#include <string>
#include "../../../../cpp/heartpy_core.h"

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


