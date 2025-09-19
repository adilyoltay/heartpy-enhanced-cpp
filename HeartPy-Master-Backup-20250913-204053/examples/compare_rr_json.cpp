#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <sstream>
#include "../cpp/heartpy_core.h"

static bool read_rr_ms(const std::string &path, std::vector<double> &out) {
    std::ifstream f(path);
    if (!f.is_open()) return false;
    std::string content, line;
    while (std::getline(f, line)) {
        if (!content.empty()) content.push_back('\n');
        content += line;
    }
    f.close();
    if (content.empty()) return false;
    for (char &ch : content) { if (ch == ',' || ch == ';') ch = '\n'; }
    std::stringstream ss(content);
    std::string tok;
    while (std::getline(ss, tok)) {
        size_t a = tok.find_first_not_of(" \t\r\n");
        size_t b = tok.find_last_not_of(" \t\r\n");
        if (a == std::string::npos) continue;
        std::string t = tok.substr(a, b - a + 1);
        try { double v = std::stod(t); if (v > 0 && v < 5000) out.push_back(v); } catch (...) {}
    }
    return !out.empty();
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: heartpy_compare_rr_json <rr_ms_csv> [cleanRR 0/1] [method 0=QF,1=IQR,2=Z] [pnnPercent 0/1] [cleanIterations]" << std::endl;
        return 2;
    }
    std::string path = argv[1];
    int clean = (argc >= 3 ? std::atoi(argv[2]) : 1);
    int meth = (argc >= 4 ? std::atoi(argv[3]) : 0);
    int pnnPercent = (argc >= 5 ? std::atoi(argv[4]) : 1);
    int cleanIter = (argc >= 6 ? std::atoi(argv[5]) : 2);
    std::vector<double> rrms;
    if (!read_rr_ms(path, rrms)) {
        std::cerr << "failed to read RR csv: " << path << std::endl;
        return 2;
    }
    heartpy::Options opt;
    opt.cleanRR = (clean != 0);
    switch (meth) {
        case 1: opt.cleanMethod = heartpy::Options::CleanMethod::IQR; break;
        case 2: opt.cleanMethod = heartpy::Options::CleanMethod::Z_SCORE; break;
        default: opt.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER; break;
    }
    opt.cleanIterations = cleanIter > 0 ? cleanIter : 2;
    opt.pnnAsPercent = (pnnPercent != 0);
    auto res = heartpy::analyzeRRIntervals(rrms, opt);
    std::cout << "{";
    std::cout << "\"bpm\":" << res.bpm << ",";
    std::cout << "\"sdnn\":" << res.sdnn << ",";
    std::cout << "\"rmssd\":" << res.rmssd << ",";
    std::cout << "\"sdsd\":" << res.sdsd << ",";
    std::cout << "\"pnn20\":" << res.pnn20 << ",";
    std::cout << "\"pnn50\":" << res.pnn50 << ",";
    std::cout << "\"sd1\":" << res.sd1 << ",";
    std::cout << "\"sd2\":" << res.sd2 << ",";
    std::cout << "\"sd1sd2Ratio\":" << res.sd1sd2Ratio << ",";
    std::cout << "\"mad\":" << res.mad;
    std::cout << "}\n";
    return 0;
}
