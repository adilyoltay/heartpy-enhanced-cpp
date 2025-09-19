#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <sstream>
#include <cstdlib>
#include "../cpp/heartpy_core.h"

static bool read_csv_column(const std::string &path, std::vector<double> &out) {
    std::ifstream f(path);
    if (!f.is_open()) return false;
    std::string content;
    std::string line;
    while (std::getline(f, line)) {
        if (!content.empty()) content.push_back('\n');
        content += line;
    }
    f.close();
    if (content.empty()) return false;
    // Replace commas and semicolons with newlines, then parse tokens
    for (char &ch : content) { if (ch == ',' || ch == ';') ch = '\n'; }
    std::stringstream ss(content);
    std::string tok;
    while (std::getline(ss, tok)) {
        // trim whitespace
        size_t a = tok.find_first_not_of(" \t\r\n");
        size_t b = tok.find_last_not_of(" \t\r\n");
        if (a == std::string::npos) continue;
        std::string t = tok.substr(a, b - a + 1);
        try {
            double v = std::stod(t);
            out.push_back(v);
        } catch (...) { /* skip */ }
    }
    return !out.empty();
}

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "usage: heartpy_compare_file_json <csv_path> <fs> [thresholdScale] [refractoryMs] [rrSplineS] [rejectSegmentwise 0/1] [segMaxRejects] [breathingAsBpm 0/1] [welchWsizeSec] [rrSplineSTargetSse]" << std::endl;
        return 2;
    }
    std::string path = argv[1];
    double fs = std::atof(argv[2]);
    double thr = (argc >= 4 ? std::atof(argv[3]) : 0.5);
    double refr = (argc >= 5 ? std::atof(argv[4]) : 250.0);
    double rrS = (argc >= 6 ? std::atof(argv[5]) : -1.0);
    int rejSeg = (argc >= 7 ? std::atoi(argv[6]) : 0);
    int segMax = (argc >= 8 ? std::atoi(argv[7]) : 3);
    int breathBpm = (argc >= 9 ? std::atoi(argv[8]) : 0);
    double welchSec = (argc >= 10 ? std::atof(argv[9]) : 240.0);
    double rrTarget = (argc >= 11 ? std::atof(argv[10]) : -1.0);

    std::vector<double> x;
    if (!read_csv_column(path, x)) {
        std::cerr << "failed to read file: " << path << std::endl;
        return 2;
    }

    heartpy::Options opt;
    // Use the same pre-filtered data as Python side; disable extra C++ bandpass here
    opt.lowHz = 0.0; opt.highHz = 0.0; opt.iirOrder = 2;
    opt.refractoryMs = refr; opt.thresholdScale = thr;
    opt.bpmMin = 40.0; opt.bpmMax = 180.0;
    // HeartPy process() default: clean_rr=False; keep parity here
    opt.cleanRR = false; opt.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER;
    // Parity on pNN: report as ratio 0..1 to match Python normalization
    opt.pnnAsPercent = false;
    if (rrS >= 0.0) opt.rrSplineS = rrS;
    if (rrTarget >= 0.0) opt.rrSplineSTargetSse = rrTarget;
    opt.rejectSegmentwise = (rejSeg != 0);
    opt.segmentRejectMaxRejects = segMax;
    opt.breathingAsBpm = (breathBpm != 0);
    opt.welchWsizeSec = welchSec;

    auto res = heartpy::analyzeSignal(x, fs, opt);

    std::cout << "{";
    std::cout << "\"bpm\":" << res.bpm << ",";
    std::cout << "\"n_peaks\":" << res.peakList.size() << ",";
    std::cout << "\"sdnn\":" << res.sdnn << ",";
    std::cout << "\"rmssd\":" << res.rmssd << ",";
    std::cout << "\"pnn50\":" << res.pnn50 << ",";
    std::cout << "\"vlf\":" << res.vlf << ",";
    std::cout << "\"lf\":" << res.lf << ",";
    std::cout << "\"hf\":" << res.hf << ",";
    std::cout << "\"lf_hf\":" << res.lfhf << ",";
    std::cout << "\"breathingrate\":" << res.breathingRate;
    std::cout << "}\n";
    return 0;
}
