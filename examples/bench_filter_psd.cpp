#include <chrono>
#include <cstdio>
#include <vector>
#include <cmath>
#include "../cpp/heartpy_core.h"

using Steady = std::chrono::steady_clock;

int main(int argc, char** argv) {
    double fs = 50.0;
    double sec = 120.0; // longer to expose timing
    int nfft = 4096;    // heavier default
    int reps = 25;      // repeat PSD calculation to accumulate time
    // Optional CLI overrides: [sec] [nfft] [reps]
    // Usage: bench_filter_psd 180 4096 50
    if (argc >= 2) sec = std::atof(argv[1]);
    if (argc >= 3) nfft = std::atoi(argv[2]);
    if (argc >= 4) reps = std::atoi(argv[3]);

    const int n = static_cast<int>(fs * sec);
    std::vector<double> x(n);
    double f = 1.2; // ~72 bpm
    const double TWOPI = 6.28318530717958647693;
    for (int i = 0; i < n; ++i) {
        double t = i / fs;
        x[i] = 0.6 * std::sin(TWOPI * f * t) + 0.05 * std::sin(TWOPI * 0.25 * t);
    }
    auto t0 = Steady::now();
    size_t freqs = 0;
    for (int r = 0; r < reps; ++r) {
        auto psd = heartpy::welchPowerSpectrum(x, fs, nfft, 0.5);
        freqs = psd.first.size();
    }
    auto t1 = Steady::now();
    auto total_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    double avg_ms = reps > 0 ? (double)total_ms / (double)reps : 0.0;
    // Compile-time flags
#ifdef HEARTPY_ENABLE_ACCELERATE
    int accel = 1;
#else
    int accel = 0;
#endif
#ifdef HEARTPY_ENABLE_NEON
    int neon = 1;
#else
    int neon = 0;
#endif
#ifdef USE_KISSFFT
    int kiss = 1;
#else
    int kiss = 0;
#endif
    std::printf("bench_filter_psd: n=%d fs=%.1f nfft=%d reps=%d time_ms=%lld avg_ms=%.2f freqs=%zu flags: accelerate=%d neon=%d kissfft=%d\n",
                n, fs, nfft, reps, (long long)total_ms, avg_ms, freqs, accel, neon, kiss);
    return 0;
}
