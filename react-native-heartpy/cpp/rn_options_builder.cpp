#include "rn_options_builder.h"
#include <cmath>
#include <limits>

static inline bool isFinite(double x) {
    return std::isfinite(x) != 0;
}

extern "C" bool hp_validate_options(double fs,
                                     const heartpy::Options& opt,
                                     const char** err_code,
                                     std::string* err_msg) {
    // fs: 1..10000
    if (!isFinite(fs) || fs < 1.0 || fs > 10000.0) {
        if (err_code) *err_code = "HEARTPY_E001"; // Invalid sample rate
        if (err_msg) *err_msg = "Invalid sample rate (1-10000 Hz)";
        return false;
    }

    // bandpass: allow disabled (<=0 means off). If enabled, 0 <= low < high <= fs/2.
    if ((opt.lowHz > 0.0 || opt.highHz > 0.0)) {
        if (!isFinite(opt.lowHz) || !isFinite(opt.highHz) || opt.lowHz < 0.0 || opt.highHz <= 0.0 || opt.lowHz >= opt.highHz || opt.highHz > (fs * 0.5)) {
            if (err_code) *err_code = "HEARTPY_E011"; // Invalid bandpass
            if (err_msg) *err_msg = "Invalid bandpass (0<=low<high<=fs/2)";
            return false;
        }
    }

    // refractoryMs: 50..2000
    if (!isFinite(opt.refractoryMs) || opt.refractoryMs < 50.0 || opt.refractoryMs > 2000.0) {
        if (err_code) *err_code = "HEARTPY_E014"; // Invalid refractory
        if (err_msg) *err_msg = "Invalid refractory (50-2000 ms)";
        return false;
    }

    // BPM range: 30 <= bpmMin < bpmMax <= 240
    if (!isFinite(opt.bpmMin) || !isFinite(opt.bpmMax) || opt.bpmMin < 30.0 || opt.bpmMax > 240.0 || !(opt.bpmMin < opt.bpmMax)) {
        if (err_code) *err_code = "HEARTPY_E013"; // Invalid BPM range
        if (err_msg) *err_msg = "Invalid BPM range (30<=min<max<=240)";
        return false;
    }

    // nfft: allowed window [64, 16384]; snap is handled elsewhere
    if (!isFinite((double)opt.nfft) || opt.nfft < 64 || opt.nfft > 16384) {
        if (err_code) *err_code = "HEARTPY_E012"; // Invalid nfft
        if (err_msg) *err_msg = "Invalid nfft (64-16384)";
        return false;
    }

    // overlap 0..1 (exclusive 1)
    if (!isFinite(opt.overlap) || opt.overlap < 0.0 || opt.overlap >= 1.0) {
        // clamp is recommended; validation accepts [0,0.95] in practice, but we reject only on NaN
        if (!isFinite(opt.overlap)) {
            if (err_code) *err_code = "HEARTPY_E015";
            if (err_msg) *err_msg = "Invalid overlap (NaN/Inf)";
            return false;
        }
    }

    // highPrecisionFs: reject only if NaN/Inf; clamp elsewhere
    if (!isFinite(opt.highPrecisionFs)) {
        if (err_code) *err_code = "HEARTPY_E015";
        if (err_msg) *err_msg = "Invalid highPrecisionFs (NaN/Inf)";
        return false;
    }

    // Other 0..1 thresholds sanity: reject only if NaN/Inf
    if (!isFinite(opt.segmentRejectThreshold) || !isFinite(opt.segmentOverlap) || !isFinite(opt.rrSplineSmooth)) {
        if (err_code) *err_code = "HEARTPY_E015";
        if (err_msg) *err_msg = "Invalid threshold (NaN/Inf)";
        return false;
    }

    return true;
}

