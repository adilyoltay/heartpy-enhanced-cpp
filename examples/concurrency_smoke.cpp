// Minimal concurrency smoke: push in one thread, poll in another
#include <iostream>
#include <thread>
#include <atomic>
#include <vector>
#include <cmath>
#include <chrono>
#include "../cpp/heartpy_stream.h"

static std::vector<float> make_chunk(double fs, double seconds, double bpm, double t0) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<float> x; x.reserve(n);
    double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = t0 + i / fs;
        float v = static_cast<float>(0.8 * std::sin(2 * M_PI * f * t) + 512.0);
        x.push_back(v);
    }
    return x;
}

int main() {
    const double fs = 50.0;
    heartpy::RealtimeAnalyzer rt(fs, heartpy::Options{});
    rt.setWindowSeconds(30.0);

    std::atomic<bool> stop{false};
    std::thread producer([&]{
        double t = 0.0; const double step = 0.2; // 200ms chunks
        while (!stop.load()) {
            auto chunk = make_chunk(fs, step, 72.0, t);
            rt.push(chunk.data(), chunk.size(), t);
            t += step;
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    });

    int polls = 0;
    auto start = std::chrono::steady_clock::now();
    while (polls < 50) {
        heartpy::HeartMetrics out;
        if (rt.poll(out)) {
            std::cout << "poll bpm=" << out.bpm << "\n";
            ++polls;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        if (std::chrono::steady_clock::now() - start > std::chrono::seconds(10)) break;
    }
    stop = true; producer.join();
    return 0;
}

