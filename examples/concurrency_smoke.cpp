#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

#include "../cpp/heartpy_core.h"
#include "../cpp/heartpy_stream.h"

// Simple concurrency smoke test: one producer pushes blocks, one consumer polls.
int main() {
    const double fs = 50.0;
    const double durationSec = 8.0; // total test time
    const double blockSec = 0.1;    // 100 ms blocks
    const size_t blockN = static_cast<size_t>(std::floor(fs * blockSec));

    heartpy::Options opt;
    opt.nfft = 512;
    opt.useHPThreshold = true;
    heartpy::RealtimeAnalyzer rt(fs, opt);
    rt.applyPresetTorch();
    rt.setWindowSeconds(30.0);
    rt.setUpdateIntervalSeconds(0.2);

    std::atomic<bool> stop{false};
    std::atomic<size_t> pushes{0}, polls{0};

    // Producer: generates a simple sine + noise and pushes in small blocks
    std::thread producer([&]() {
        double t = 0.0;
        const double dt = 1.0 / fs;
        const double f = 1.2; // ~72 bpm
        while (!stop.load(std::memory_order_relaxed)) {
            std::vector<float> block(blockN);
            for (size_t i = 0; i < blockN; ++i) {
                float s = 0.6f * std::sin(2.0f * float(M_PI) * float(f) * float(t));
                s += 0.05f * std::sin(2.0f * float(M_PI) * 0.25f * float(t));
                block[i] = s;
                t += dt;
            }
            rt.push(block.data(), block.size());
            ++pushes;
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    });

    // Consumer: polls at ~50 ms cadence
    std::thread consumer([&]() {
        while (!stop.load(std::memory_order_relaxed)) {
            heartpy::HeartMetrics out;
            if (rt.poll(out)) {
                ++polls;
                // Light output to verify activity
                std::printf("poll: bpm=%.2f conf=%.2f snr=%.2f hard=%d\n",
                            out.bpm, out.quality.confidence, out.quality.snrDb, out.quality.doublingFlag);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    });

    std::this_thread::sleep_for(std::chrono::milliseconds((int)std::round(durationSec * 1000.0)));
    stop = true;
    producer.join();
    consumer.join();

    std::printf("concurrency_smoke: pushes=%zu polls=%zu\n", pushes.load(), polls.load());
    // If we got at least some polls, consider it OK
    return (polls.load() > 0 ? 0 : 1);
}

