// Simple realtime_demo: synthesize signal, run batch analysis, print JSON
#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <cmath>
#include <cstdlib>
#include "../cpp/heartpy_core.h"

static std::vector<double> make_ppg(double fs, double seconds, double bpm, double noise = 0.03) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    unsigned s = 1234567u;
    auto rnd = [&](){ s = 1664525u * s + 1013904223u; return ((s>>8)&0xFFFFFF)/double(0xFFFFFF) - 0.5; };
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs;
        double v = 0.75 * std::sin(2 * M_PI * f * t)
                 + 0.20 * std::sin(2 * M_PI * 2 * f * t)
                 + noise * rnd()
                 + 512.0;
        x.push_back(v);
    }
    return x;
}

static std::string to_json(const heartpy::HeartMetrics& r) {
    std::ostringstream os;
    os << "{";
    os << "\"bpm\":" << r.bpm << ",";
    os << "\"sdnn\":" << r.sdnn << ",";
    os << "\"rmssd\":" << r.rmssd << ",";
    os << "\"vlf\":" << r.vlf << ",\"lf\":" << r.lf << ",\"hf\":" << r.hf << ",\"lfhf\":" << r.lfhf << ",\"totalPower\":" << r.totalPower << ",";
    os << "\"breathingRate\":" << r.breathingRate << ",";
    os << "\"quality\":{\"goodQuality\":" << (r.quality.goodQuality?"true":"false")
       << ",\"totalBeats\":" << r.quality.totalBeats
       << ",\"rejectedBeats\":" << r.quality.rejectedBeats
       << ",\"rejectionRate\":" << r.quality.rejectionRate
       << ",\"snrDb\":" << r.quality.snrDb
       << ",\"confidence\":" << r.quality.confidence
       << "}";
    os << "}";
    return os.str();
}

int main(int argc, char** argv) {
    // defaults
    double fs = 50.0;
    double seconds = 60.0;
    bool highPrecision = false;
    bool deterministic = false;
    std::string preset; // "torch" | "ambient" | ""

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if ((a == "--fs" || a == "-f") && i + 1 < argc) { fs = std::atof(argv[++i]); }
        else if ((a == "--seconds" || a == "-s") && i + 1 < argc) { seconds = std::atof(argv[++i]); }
        else if (a == "--high-precision") { highPrecision = true; }
        else if (a == "--deterministic") { deterministic = true; }
        else if (a == "--preset" && i + 1 < argc) { preset = argv[++i]; }
    }

    // Build options
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    opt.highPrecision = highPrecision; opt.highPrecisionFs = 1000.0;
    opt.deterministic = deterministic;
    if (preset == "torch") { opt.lowHz = 0.7; opt.highHz = 3.0; opt.refractoryMs = std::max(300.0, opt.refractoryMs); opt.useHPThreshold = true; }
    else if (preset == "ambient") { opt.lowHz = 0.5; opt.highHz = 3.5; opt.refractoryMs = std::max(320.0, opt.refractoryMs); opt.useHPThreshold = true; }

    // Note: analyzeSignal uses batch; deterministic affects internal spectral path via setDeterministic()
    heartpy::setDeterministic(opt.deterministic);

    // Synthesize a clean-ish PPG around 72 BPM
    auto signal = make_ppg(fs, seconds, 72.0);
    auto res = heartpy::analyzeSignal(signal, fs, opt);
    std::cout << to_json(res) << std::endl;
    return 0;
}

