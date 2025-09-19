#include <chrono>
#include <cstdio>
#include <vector>
#include <cmath>
#include <algorithm>
#include <numeric>
#include "../cpp/heartpy_core.h"
#include "../cpp/heartpy_stream.h"

using Clock = std::chrono::steady_clock;

static std::vector<float> gen_sine(float fs, float seconds, float freq) {
    size_t n = (size_t)std::floor(fs * seconds);
    std::vector<float> y; y.reserve(n);
    const float twopi = 6.2831853071795864769f;
    for (size_t i = 0; i < n; ++i) {
        float t = (float)i / fs;
        float s = 0.6f * std::sin(twopi * freq * t);
        float noise = 0.05f * std::sin(twopi * 0.25f * t);
        y.push_back(s + noise);
    }
    return y;
}

static double percentile(std::vector<double>& a, double p) {
    if (a.empty()) return 0.0; std::sort(a.begin(), a.end());
    size_t idx = (size_t)std::min<double>(a.size() - 1, std::floor((p/100.0) * (a.size()-1)));
    return a[idx];
}

int main(int argc, char** argv) {
    double fs = 50.0;
    double sec = 120.0;
    double blockSec = 0.2;
    bool useRing = false;
    if (argc >= 2) sec = std::atof(argv[1]);
    for (int i = 1; i + 1 < argc; ++i) {
        std::string k = argv[i]; std::string v = argv[i+1];
        auto to_d = [&](const std::string& s){ return std::atof(s.c_str()); };
        if (k == std::string("--fs")) fs = to_d(v);
        if (k == std::string("--block")) blockSec = to_d(v);
        if (k == std::string("--use-ring")) {
            std::string vv=v; for (auto &c:vv) c=(char)std::tolower(c);
            useRing = (vv=="1"||vv=="true"||vv=="on");
        }
    }

    heartpy::Options opt;
    opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    opt.nfft = 1024; opt.refractoryMs = 320.0; opt.thresholdScale = 0.5;
    opt.useHPThreshold = true; opt.maPerc = 30.0; opt.adaptiveMaPerc = true;
    opt.breathingAsBpm = false;
    opt.useRingBuffer = useRing;

    heartpy::RealtimeAnalyzer rt(fs, opt);
    rt.applyPresetTorch();
    rt.setWindowSeconds(60.0);
    rt.setUpdateIntervalSeconds(1.0);
    rt.setPsdUpdateSeconds(1.0);
    rt.setDisplayHz(30.0);

    auto blk = gen_sine((float)fs, (float)blockSec, 1.2f);
    const size_t blockN = blk.size();
    size_t totalBlocks = (size_t)std::ceil(sec / blockSec);

    std::vector<double> all_ms; all_ms.reserve(totalBlocks);
    std::vector<double> emit_ms; emit_ms.reserve((size_t)sec);
    for (size_t b = 0; b < totalBlocks; ++b) {
        rt.push(blk.data(), blockN);
        auto t0 = Clock::now();
        heartpy::HeartMetrics out;
        bool ok = rt.poll(out);
        auto t1 = Clock::now();
        double ms = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count() / 1000.0;
        all_ms.push_back(ms);
        if (ok) emit_ms.push_back(ms);
    }
    double avg_all = all_ms.empty()?0.0: (std::accumulate(all_ms.begin(), all_ms.end(), 0.0)/all_ms.size());
    double p95_all = percentile(all_ms, 95.0);
    double avg_emit = emit_ms.empty()?0.0: (std::accumulate(emit_ms.begin(), emit_ms.end(), 0.0)/emit_ms.size());
    double p95_emit = percentile(emit_ms, 95.0);

    double samples_per_sec = fs;
    double emits_per_sec = emit_ms.size() / sec;
    double emit_ratio = emit_ms.empty()?0.0: (emit_ms.size() / (double)all_ms.size());
    // Compile-time flags
#ifdef HEARTPY_ENABLE_ACCELERATE
    int accel = 1;
#else
    int accel = 0;
#endif
    double l1_avg=0.0, l1_p95=0.0, l2_avg=0.0, l2_p95=0.0;
#ifdef HEARTPY_LOCK_TIMING
    heartpy::RealtimeAnalyzer::lockStatsGet(1, l1_avg, l1_p95, /*reset*/true);
    heartpy::RealtimeAnalyzer::lockStatsGet(2, l2_avg, l2_p95, /*reset*/true);
#endif
    std::printf("bench_poll_latency: ring=%s fs=%.1f sec=%.0f block=%.3f polls=%zu emits=%zu avg_all_ms=%.3f p95_all_ms=%.3f avg_emit_ms=%.3f p95_emit_ms=%.3f samples_per_sec=%.1f emits_per_sec=%.2f emit_ratio=%.2f lock1_avg_us=%.1f lock1_p95_us=%.1f lock2_avg_us=%.1f lock2_p95_us=%.1f flags: accelerate=%d\n",
                useRing?"ON":"OFF", fs, sec, blockSec, all_ms.size(), emit_ms.size(), avg_all, p95_all, avg_emit, p95_emit,
                samples_per_sec, emits_per_sec, emit_ratio, l1_avg, l1_p95, l2_avg, l2_p95, accel);
    return 0;
}
