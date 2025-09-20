// Minimal benchmark: run batch analysis repeatedly and report time
#include <iostream>
#include <vector>
#include <chrono>
#include <cmath>
#include "../cpp/heartpy_core.h"

static std::vector<double> make(double fs, double seconds, double bpm) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs; x.push_back(0.8 * std::sin(2 * M_PI * f * t) + 512.0);
    }
    return x;
}

int main() {
    const double fs = 50.0; auto sig = make(fs, 60.0, 72.0);
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2; opt.nfft = 1024; opt.overlap = 0.5;
    auto t0 = std::chrono::steady_clock::now();
    heartpy::HeartMetrics last{};
    for (int i = 0; i < 20; ++i) last = heartpy::analyzeSignal(sig, fs, opt);
    auto t1 = std::chrono::steady_clock::now();
    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    std::cout << "bench_filter_psd: 20 runs in " << ms << " ms, last bpm=" << last.bpm << "\n";
    return 0;
}

