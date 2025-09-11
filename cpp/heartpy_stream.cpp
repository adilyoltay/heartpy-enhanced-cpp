#include "heartpy_stream.h"
#include <algorithm>

namespace heartpy {

RealtimeAnalyzer::RealtimeAnalyzer(double fs, const Options& opt)
    : fs_(fs), opt_(opt) {
    if (fs_ <= 0.0) fs_ = 50.0;
    if (windowSec_ < 1.0) windowSec_ = 10.0;
    if (updateSec_ <= 0.0) updateSec_ = 1.0;
    signal_.reserve(static_cast<size_t>(windowSec_ * fs_) + 8 * static_cast<size_t>(fs_));
}

void RealtimeAnalyzer::setWindowSeconds(double sec) {
    windowSec_ = std::max(1.0, sec);
    trimToWindow();
}

void RealtimeAnalyzer::setUpdateIntervalSeconds(double sec) {
    updateSec_ = std::max(0.1, sec);
}

void RealtimeAnalyzer::append(const float* x, size_t n) {
    if (!x || n == 0) return;
    signal_.insert(signal_.end(), x, x + n);
    // For a display buffer, keep the same content in this phase
    displayBuf_ = signal_;
    secondsFromSamples_ += static_cast<double>(n) / fs_;
    trimToWindow();
}

void RealtimeAnalyzer::trimToWindow() {
    const size_t maxSamples = static_cast<size_t>(windowSec_ * fs_);
    if (signal_.size() > maxSamples) {
        const size_t drop = signal_.size() - maxSamples;
        signal_.erase(signal_.begin(), signal_.begin() + drop);
    }
    if (displayBuf_.size() > signal_.size()) displayBuf_.resize(signal_.size());
}

void RealtimeAnalyzer::push(const float* samples, size_t n, double /*t0*/) {
    append(samples, n);
}

void RealtimeAnalyzer::push(const std::vector<double>& samples, double /*t0*/) {
    if (samples.empty()) return;
    std::vector<float> tmp(samples.size());
    for (size_t i = 0; i < samples.size(); ++i) tmp[i] = static_cast<float>(samples[i]);
    append(tmp.data(), tmp.size());
}

bool RealtimeAnalyzer::poll(HeartMetrics& out) {
    // Only emit once per updateSec_ of newly received samples
    if ((secondsFromSamples_ - lastEmitTime_) < updateSec_) return false;

    lastEmitTime_ = secondsFromSamples_;

    // Batch fallback: analyze the current sliding window via analyzeSignal()
    if (signal_.empty()) return false;
    std::vector<double> win; win.reserve(signal_.size());
    for (float v : signal_) win.push_back(static_cast<double>(v));
    // Disable double filtering if upstream already filtered in app layer:
    Options o = opt_;
    // Keep user-configured bandpass; callers may set lowHz=highHz=0 to skip
    out = analyzeSignal(win, fs_, o);

    // Cache a few items for convenience
    lastQuality_ = out.quality;
    lastPeaks_ = out.peakList;
    lastRR_ = out.rrList;
    return true;
}

} // namespace heartpy

// Plain C bridge
struct _hp_rt_handle { heartpy::RealtimeAnalyzer* p; };

void* hp_rt_create(double fs, const heartpy::Options* opt) {
    auto* h = new _hp_rt_handle();
    heartpy::Options o = opt ? *opt : heartpy::Options{};
    h->p = new heartpy::RealtimeAnalyzer(fs, o);
    return h;
}

void  hp_rt_set_window(void* h, double sec) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->setWindowSeconds(sec);
}

void  hp_rt_set_update_interval(void* h, double sec) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->setUpdateIntervalSeconds(sec);
}

void  hp_rt_push(void* h, const float* x, size_t n, double t0) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->push(x, n, t0);
}

int   hp_rt_poll(void* h, heartpy::HeartMetrics* out) {
    if (!h || !out) return 0; auto* S = reinterpret_cast<_hp_rt_handle*>(h); return S->p->poll(*out) ? 1 : 0;
}

void  hp_rt_destroy(void* h) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); delete S->p; delete S;
}

