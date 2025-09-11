#include <iostream>
#include <vector>
#include <cmath>
#include <chrono>
#include <thread>
#include "../cpp/heartpy_core.h"
#include "../cpp/heartpy_stream.h"

static std::vector<float> gen_sine(float fs, float seconds, float freq) {
    size_t n = (size_t)std::floor(fs * seconds);
    std::vector<float> y; y.reserve(n);
    for (size_t i = 0; i < n; ++i) {
        float t = (float)i / fs;
        float s = 0.6f * std::sin(2.0f * (float)M_PI * freq * t);
        float noise = 0.05f * std::sin(2.0f * (float)M_PI * 0.25f * t);
        y.push_back(s + noise);
    }
    return y;
}

int main(int argc, char** argv) {
    double fs = 50.0;
    double runSec = 20.0;
    if (argc >= 2) fs = std::atof(argv[1]);
    if (argc >= 3) runSec = std::atof(argv[2]);

    heartpy::Options opt;
    opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    opt.refractoryMs = 250.0; opt.thresholdScale = 0.5;
    opt.breathingAsBpm = false;

    heartpy::RealtimeAnalyzer rt(fs, opt);
    rt.setWindowSeconds(60.0);
    rt.setUpdateIntervalSeconds(1.0);
    rt.setPsdUpdateSeconds(2.0);
    rt.setDisplayHz(30.0);

    const float hr_hz = 1.2f; // ~72 bpm
    const double blockSec = 0.2; // push in 200ms blocks
    const size_t blockN = (size_t)std::floor(fs * blockSec);
    size_t totalBlocks = (size_t)std::ceil(runSec / blockSec);

    for (size_t b = 0; b < totalBlocks; ++b) {
        auto blk = gen_sine((float)fs, (float)blockSec, hr_hz);
        rt.push(blk.data(), blk.size());
        heartpy::HeartMetrics out;
        if (rt.poll(out)) {
            std::cout << "t=" << (b * blockSec)
                      << "s, BPM=" << out.bpm
                      << ", conf=" << out.quality.confidence
                      << ", breath=" << out.breathingRate
                      << ", rej=" << (out.quality.rejectionRate * 100.0) << "%"
                      << std::endl;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds((int)std::round(1000.0 * blockSec)));
    }
    return 0;
}

