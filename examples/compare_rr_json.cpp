// Analyze supplied RR intervals and output JSON
#include <iostream>
#include <vector>
#include <sstream>
#include "../cpp/heartpy_core.h"

static std::string to_json(const heartpy::HeartMetrics& r) {
    std::ostringstream os;
    os << "{";
    os << "\"bpm\":" << r.bpm << ",\"sdnn\":" << r.sdnn << ",\"rmssd\":" << r.rmssd;
    os << "}";
    return os.str();
}

int main(int argc, char** argv) {
    std::vector<double> rr;
    if (argc > 1) {
        for (int i = 1; i < argc; ++i) rr.push_back(std::atof(argv[i]));
    } else {
        rr = {800, 780, 790, 810, 805, 795, 785, 800};
    }
    auto r = heartpy::analyzeRRIntervals(rr, heartpy::Options{});
    std::cout << to_json(r) << std::endl;
    return 0;
}

