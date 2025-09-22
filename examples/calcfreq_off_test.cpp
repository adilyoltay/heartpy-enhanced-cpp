#include "../cpp/heartpy_core.h"

#include <cmath>
#include <iostream>
#include <vector>

static std::vector<double> make_ppg(double fs, double seconds, double bpm) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs;
        double v = 0.8 * std::sin(2 * M_PI * f * t) + 0.15 * std::sin(2 * M_PI * 2 * f * t) + 512.0;
        x.push_back(v);
    }
    return x;
}

int main() {
    const double fs = 50.0;
    auto sig = make_ppg(fs, 30.0, 72.0);
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2; opt.calcFreq = false;
    auto r = heartpy::analyzeSignal(sig, fs, opt);
    bool allNaN = std::isnan(r.vlf) && std::isnan(r.lf) && std::isnan(r.hf) && std::isnan(r.lfhf);
    std::cout << (allNaN ? "OK" : "FAIL") << "\n";
    return allNaN ? 0 : 1;
}

