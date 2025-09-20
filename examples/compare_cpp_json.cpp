// Output analysis as compact JSON for a synthetic signal
#include <iostream>
#include <vector>
#include <cmath>
#include <sstream>
#include "../cpp/heartpy_core.h"

static std::vector<double> make(double fs, double seconds, double bpm) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs;
        x.push_back(0.8 * std::sin(2 * M_PI * f * t) + 512.0);
    }
    return x;
}

static std::string to_json(const heartpy::HeartMetrics& r) {
    std::ostringstream os;
    os << "{";
    os << "\"bpm\":" << r.bpm << ",";
    os << "\"sdnn\":" << r.sdnn << ",";
    os << "\"rmssd\":" << r.rmssd << ",";
    os << "\"quality\":{\"goodQuality\":" << (r.quality.goodQuality?"true":"false")
       << ",\"totalBeats\":" << r.quality.totalBeats << "}";
    os << "}";
    return os.str();
}

int main() {
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    auto r = heartpy::analyzeSignal(make(50, 30, 72), 50, opt);
    std::cout << to_json(r) << "\n";
    return 0;
}

