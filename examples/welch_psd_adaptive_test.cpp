#include "heartpy_core.h"

#include <cmath>
#include <iostream>
#include <vector>

using heartpy::getWelchPsdGuardFailureCount;
using heartpy::getWelchPsdGuardFallbackCount;
using heartpy::welchPowerSpectrum;

static constexpr double kPi = 3.14159265358979323846264338327950288;

static std::vector<double> makeSine(size_t count, double fs, double hz) {
    std::vector<double> data(count);
    const double twoPi = 2.0 * kPi;
    for (size_t i = 0; i < count; ++i) {
        double t = static_cast<double>(i) / fs;
        data[i] = std::sin(twoPi * hz * t);
    }
    return data;
}

int main() {
    const double fs = 30.0;
    const double hz = 1.2;

    auto fallbackBefore = getWelchPsdGuardFallbackCount();
    auto failureBefore = getWelchPsdGuardFailureCount();

    auto sig150 = makeSine(150, fs, hz);
    auto res150 = welchPowerSpectrum(sig150, fs, 256, 0.5);
    if (res150.first.empty() || res150.second.empty()) {
        std::cerr << "Expected adaptive PSD to return bins for 150-sample buffer" << std::endl;
        return 1;
    }

    auto sig80 = makeSine(80, fs, hz);
    auto res80 = welchPowerSpectrum(sig80, fs, 256, 0.5);
    if (res80.first.empty() || res80.second.empty()) {
        std::cerr << "Expected adaptive PSD to return bins for 80-sample buffer" << std::endl;
        return 1;
    }

    auto sig50 = makeSine(50, fs, hz);
    auto res50 = welchPowerSpectrum(sig50, fs, 256, 0.5);
    if (!res50.first.empty()) {
        std::cerr << "Expected PSD to fail for <64 sample buffer" << std::endl;
        return 1;
    }

    auto fallbackAfter = getWelchPsdGuardFallbackCount();
    auto failureAfter = getWelchPsdGuardFailureCount();

    if (fallbackAfter <= fallbackBefore) {
        std::cerr << "Expected fallback counter to increase when adapting NFFT" << std::endl;
        return 1;
    }
    if (failureAfter < failureBefore) {
        std::cerr << "Failure counter should not decrease" << std::endl;
        return 1;
    }

    return 0;
}
