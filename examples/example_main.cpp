// Minimal example: analyze synthetic PPG and print BPM
#include <iostream>
#include <vector>
#include <cmath>
#include "../cpp/heartpy_core.h"

static std::vector<double> make_sine_ppg(double fs, double seconds, double bpm = 72.0) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs;
        double v = 0.7 * std::sin(2 * M_PI * f * t)
                 + 0.2 * std::sin(2 * M_PI * 2 * f * t)
                 + 0.1 * std::sin(2 * M_PI * 3 * f * t)
                 + 512.0; // DC level typical of 10-bit sensor
        x.push_back(v);
    }
    return x;
}

int main() {
    double fs = 50.0;
    double seconds = 30.0;
    auto signal = make_sine_ppg(fs, seconds, 72.0);
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    auto res = heartpy::analyzeSignal(signal, fs, opt);
    std::cout << "BPM: " << res.bpm << "\n";
    return 0;
}

