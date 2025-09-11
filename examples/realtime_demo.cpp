#include <iostream>
#include <fstream>
#include <iomanip>
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
    std::string preset = "torch"; // torch | ambient
    bool fast = false;             // if true, do not sleep between blocks
    if (argc >= 2) fs = std::atof(argv[1]);
    if (argc >= 3) runSec = std::atof(argv[2]);
    if (argc >= 4) preset = argv[3];
    if (argc >= 5) { std::string f = argv[4]; fast = (f == "fast" || f == "1" || f == "true"); }
    // Optional: named flag --json-out <path>
    std::string jsonOutPath;
    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--json-out" && (i + 1) < argc) {
            jsonOutPath = argv[i + 1];
        }
    }
    double refMsOverride = -1.0;
    if (argc >= 6) refMsOverride = std::atof(argv[5]);

    heartpy::Options opt;
    opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
    opt.nfft = 1024; // finer df so SNR band widths (±0.12/0.18 Hz) are effective
    opt.refractoryMs = 320.0; opt.thresholdScale = 0.5;
    opt.useHPThreshold = true; opt.maPerc = 30.0; opt.adaptiveMaPerc = true;
    opt.breathingAsBpm = false;

    // Named CLI overrides for streaming Options
    for (int i = 1; i + 1 < argc; ++i) {
        std::string key = argv[i]; std::string val = argv[i + 1];
        auto to_d = [&](const std::string& s){ return std::atof(s.c_str()); };
        auto to_i = [&](const std::string& s){ return std::atoi(s.c_str()); };
        if (key == "--nfft") {
            int raw = to_i(val);
            int cand[3] = {256,512,1024};
            int best = cand[0]; int bestd = std::abs(raw - cand[0]);
            for (int i = 1; i < 3; ++i) { int d = std::abs(raw - cand[i]); if (d < bestd) { bestd = d; best = cand[i]; } }
            opt.nfft = best;
        }
        if (key == "--ref-ms") opt.refractoryMs = to_d(val);
        if (key == "--minrr-coeff") opt.minRRGateFactor = to_d(val);
        if (key == "--minrr-floor-relaxed") opt.minRRFloorRelaxed = to_d(val);
        if (key == "--minrr-floor-strict") opt.minRRFloorStrict = to_d(val);
        if (key == "--rr-merge-band-low") opt.rrMergeBandLow = to_d(val);
        if (key == "--rr-merge-band-high") opt.rrMergeBandHigh = to_d(val);
        if (key == "--rr-merge-eq-low") opt.rrMergeEqualBandLow = to_d(val);
        if (key == "--rr-merge-eq-high") opt.rrMergeEqualBandHigh = to_d(val);
        if (key == "--periodic-supp-tol") opt.periodicSuppressionTol = to_d(val);
        if (key == "--snr-band-passive") opt.snrBandPassive = to_d(val);
        if (key == "--snr-band-active") opt.snrBandActive = to_d(val);
        if (key == "--snr-active-tau") opt.snrActiveTauSec = to_d(val);
        if (key == "--snr-band-blend") opt.snrBandBlendFactor = to_d(val);
        if (key == "--threshold-scale") opt.thresholdScale = to_d(val);
    }

    if (refMsOverride > 0) opt.refractoryMs = refMsOverride;
    heartpy::RealtimeAnalyzer rt(fs, opt);
    if (preset == "ambient") rt.applyPresetAmbient(); else rt.applyPresetTorch();
    rt.setWindowSeconds(60.0);
    rt.setUpdateIntervalSeconds(1.0);
    rt.setPsdUpdateSeconds(1.0);
    rt.setDisplayHz(30.0);

    const float hr_hz = 1.2f; // ~72 bpm
    const double blockSec = 0.2; // push in 200ms blocks
    const size_t blockN = (size_t)std::floor(fs * blockSec);
    size_t totalBlocks = (size_t)std::ceil(runSec / blockSec);

    std::ofstream jsonFile;
    bool jsonEnabled = !jsonOutPath.empty();
    if (jsonEnabled) {
        jsonFile.open(jsonOutPath, std::ios::out | std::ios::trunc);
        if (!jsonFile) {
            std::cerr << "warning: could not open --json-out path: " << jsonOutPath << ", disabling JSON output\n";
            jsonEnabled = false;
        }
        jsonFile << std::fixed << std::setprecision(6);
    }

    for (size_t b = 0; b < totalBlocks; ++b) {
        auto blk = gen_sine((float)fs, (float)blockSec, hr_hz);
        rt.push(blk.data(), blk.size());
        heartpy::HeartMetrics out;
        if (rt.poll(out)) {
            double tsec = (b * blockSec);
            double bpm_stream = out.bpm;
            if (!out.rrList.empty()) {
                double s=0.0; int c=0; for (double r: out.rrList) { s+=r; ++c; }
                if (c>0) { double m = s/c; if (m>1e-6) bpm_stream = 60000.0/m; }
            }
            // Prefer RR-median derived BPM; only override with f0Used when harmonic flags are active
            if ((out.quality.softDoublingFlag || out.quality.doublingFlag || out.quality.doublingHintFlag) && out.quality.f0Hz > 0.0) {
                bpm_stream = 60.0 * out.quality.f0Hz;
            }
            if (jsonEnabled) {
                // Emit JSON line (only acceptance-relevant fields)
                jsonFile << "{"
                         << "\"t\":" << tsec
                         << ",\"stream_bpm\":" << bpm_stream
                         << ",\"conf\":" << out.quality.confidence
                         << ",\"snr_db\":" << out.quality.snrDb
                         << ",\"ma_perc\":" << out.quality.maPercActive
                         << ",\"rejection\":" << out.quality.rejectionRate
                         << ",\"hard_dbl\":" << (out.quality.doublingFlag ? 1 : 0)
                         << "}" << '\n';
                jsonFile.flush();
            } else {
                // Human-readable line
                std::cout << "t=" << tsec
                          << "s, BPM=" << out.bpm
                          << " (stream=" << bpm_stream << ")"
                          << ", conf=" << out.quality.confidence
                          << " (snr=" << out.quality.snrDb << ", f0HzUsed=" << out.quality.f0Hz
                          << ", ma=" << out.quality.maPercActive
                          << ", soft_dbl=" << out.quality.softDoublingFlag
                          << "(streak=" << out.quality.softStreak << ", secs=" << out.quality.softSecs << ")"
                         << ", hard_dbl=" << out.quality.doublingFlag
                         << ", hint=" << out.quality.doublingHintFlag
                         << ", hard_fallback=" << out.quality.hardFallbackActive
                          << ", pHalfFund=" << out.quality.pHalfOverFund
                          << ", pairFrac=" << out.quality.pairFrac
                          << ", shortFrac=" << out.quality.rrShortFrac
                          << ", longRR=" << out.quality.rrLongMs
                          << ", refMs=" << out.quality.refractoryMsActive
                          << ", minRR=" << out.quality.minRRBoundMs
                          << ", breath=" << out.breathingRate
                         << ", rej=" << (out.quality.rejectionRate * 100.0) << "%"
                          << std::endl;
            }
        }
        if (!fast) std::this_thread::sleep_for(std::chrono::milliseconds((int)std::round(1000.0 * blockSec)));
    }
    if (jsonFile.is_open()) jsonFile.close();
    return 0;
}
