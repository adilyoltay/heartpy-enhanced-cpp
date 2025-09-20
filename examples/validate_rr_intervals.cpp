// Minimal RR-only validation example
#include <iostream>
#include <vector>
#include "../cpp/heartpy_core.h"

int main() {
    std::vector<double> rrMs = {800, 780, 790, 810, 805, 795, 785, 800};
    heartpy::Options opt; // defaults
    auto r = heartpy::analyzeRRIntervals(rrMs, opt);
    std::cout << "BPM_from_RR: " << r.bpm << " SDNN: " << r.sdnn << " RMSSD: " << r.rmssd << "\n";
    return 0;
}

