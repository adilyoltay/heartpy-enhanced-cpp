// Minimal poll latency test: measure average poll() call overhead
#include <iostream>
#include <vector>
#include <chrono>
#include <thread>
#include <cmath>
#include "../cpp/heartpy_stream.h"

int main() {
    const double fs = 50.0;
    heartpy::Options opt; opt.useRingBuffer = false;
    heartpy::RealtimeAnalyzer rt(fs, opt);
    rt.setWindowSeconds(30.0);

    // Pre-fill a bit
    std::vector<float> chunk(1000, 512.0f);
    rt.push(chunk.data(), chunk.size(), 0.0);

    // Poll loop
    const int N = 500;
    auto t0 = std::chrono::steady_clock::now();
    heartpy::HeartMetrics out;
    for (int i = 0; i < N; ++i) {
        (void)rt.poll(out);
    }
    auto t1 = std::chrono::steady_clock::now();
    double us = std::chrono::duration<double, std::micro>(t1 - t0).count() / N;
    std::cout << "poll_latency_us_avg=" << us << "\n";
    return 0;
}

