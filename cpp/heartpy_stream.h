// Realtime streaming analyzer (skeleton) — Phase S1
#pragma once

#include <vector>
#include <cstddef>
#include "heartpy_core.h"

namespace heartpy {

// A minimal, non-breaking streaming API skeleton.
// Internally uses a batch fallback on the sliding window until
// fully incremental path (peaks/filters) is implemented in later phases.
class RealtimeAnalyzer {
public:
    explicit RealtimeAnalyzer(double fs, const Options& opt = {});

    void setWindowSeconds(double sec);              // 10–60 seconds typical
    void setUpdateIntervalSeconds(double sec);      // default 1.0 second

    void push(const float* samples, size_t n, double t0 = 0.0);
    void push(const std::vector<double>& samples, double t0 = 0.0);

    // If a new update is ready (>= update interval), fills out and returns true
    bool poll(HeartMetrics& out);

    QualityInfo getQuality() const { return lastQuality_; }
    const std::vector<int>& latestPeaks() const { return lastPeaks_; }
    const std::vector<double>& latestRR() const { return lastRR_; }
    const std::vector<float>& displayBuffer() const { return displayBuf_; }

private:
    void append(const float* x, size_t n);
    void trimToWindow();

    double fs_ {0.0};
    Options opt_ {};
    double windowSec_ {60.0};
    double updateSec_ {1.0};

    // crude monotonic time from sample count, if no timestamps used
    double secondsFromSamples_ {0.0};
    double lastEmitTime_ {0.0};

    // Sliding window buffers (raw for now; later phases will hold filtered/causal)
    std::vector<float> signal_;
    std::vector<float> displayBuf_; // downsampled or same as signal for now

    // Cached outputs from last poll
    QualityInfo lastQuality_ {};
    std::vector<int> lastPeaks_ {};
    std::vector<double> lastRR_ {};
};

} // namespace heartpy

// Optional plain C bridge (symbols have C linkage; still compiled as C++)
extern "C" {
    void* hp_rt_create(double fs, const heartpy::Options* opt);
    void  hp_rt_set_window(void* h, double sec);
    void  hp_rt_set_update_interval(void* h, double sec);
    void  hp_rt_push(void* h, const float* x, size_t n, double t0);
    int   hp_rt_poll(void* h, heartpy::HeartMetrics* out);
    void  hp_rt_destroy(void* h);
}

