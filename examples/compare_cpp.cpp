// Compare two analyses on slightly different signals
#include <iostream>
#include <vector>
#include <cmath>
#include "../cpp/heartpy_core.h"

static std::vector<double> make(double fs, double seconds, double bpm, double noise=0.0) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    unsigned s = 12345;
    auto rnd = [&](){ s = 1664525u * s + 1013904223u; return ((s >> 8) & 0xFFFFFF) / double(0xFFFFFF) - 0.5; };
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs;
        double v = std::sin(2 * M_PI * f * t) + 0.2 * std::sin(2 * M_PI * 2 * f * t) + noise * rnd() + 512.0;
        x.push_back(v);
    }
    return x;
}

int main() {
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    auto a = heartpy::analyzeSignal(make(50, 30, 72, 0.02), 50, opt);
    auto b = heartpy::analyzeSignal(make(50, 30, 74, 0.05), 50, opt);
    std::cout << "A bpm=" << a.bpm << " B bpm=" << b.bpm << " diff=" << (b.bpm - a.bpm) << "\n";
    return 0;
}

