// Read doubles from a file (optional) and output compact JSON analysis
#include <iostream>
#include <fstream>
#include <vector>
#include <sstream>
#include <cmath>
#include "../cpp/heartpy_core.h"

static std::vector<double> load_file(const char* path) {
    std::ifstream f(path);
    std::vector<double> v;
    if (!f.good()) return v;
    double x;
    while (f >> x) v.push_back(x);
    return v;
}

static std::vector<double> make(double fs, double seconds, double bpm) {
    const size_t n = static_cast<size_t>(fs * seconds);
    std::vector<double> x; x.reserve(n);
    const double f = bpm / 60.0;
    for (size_t i = 0; i < n; ++i) {
        double t = i / fs; x.push_back(std::sin(2 * M_PI * f * t) + 512.0);
    }
    return x;
}

static std::string to_json(const heartpy::HeartMetrics& r) {
    std::ostringstream os;
    os << "{";
    os << "\"bpm\":" << r.bpm << ",";
    os << "\"lfhf\":" << r.lfhf << ",";
    os << "\"breathingRate\":" << r.breathingRate;
    os << "}";
    return os.str();
}

int main(int argc, char** argv) {
    const double fs = 50.0;
    std::vector<double> x = (argc > 1) ? load_file(argv[1]) : make(fs, 30.0, 72.0);
    if (x.empty()) {
        std::cerr << "No data" << std::endl; return 1;
    }
    heartpy::Options opt; opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    auto r = heartpy::analyzeSignal(x, fs, opt);
    std::cout << to_json(r) << std::endl;
    return 0;
}

