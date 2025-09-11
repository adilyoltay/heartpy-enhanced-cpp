#include "heartpy_stream.h"
#include <algorithm>
#include <deque>
#include <cmath>

namespace heartpy {

static std::vector<SBiquad> designBandpassStream(double fs, double lowHz, double highHz, int sections) {
    std::vector<SBiquad> chain;
    if (lowHz <= 0.0 && highHz <= 0.0) return chain;
    if (fs <= 0.0) return chain;
    sections = std::max(1, sections);
    double f0 = (lowHz > 0.0 && highHz > 0.0) ? 0.5 * (lowHz + highHz)
                                              : std::max(0.001, (lowHz > 0.0 ? lowHz : highHz));
    double bw = (lowHz > 0.0 && highHz > 0.0) ? (highHz - lowHz) : std::max(0.25, f0 * 0.5);
    double Q = std::max(0.2, f0 / std::max(1e-9, bw));
    const double w0 = 2.0 * 3.141592653589793 * f0 / fs;
    const double alpha = std::sin(w0) / (2.0 * Q);
    const double cosw0 = std::cos(w0);
    double b0 =   alpha;
    double b1 =   0.0;
    double b2 =  -alpha;
    double a0 =   1.0 + alpha;
    double a1 =  -2.0 * cosw0;
    double a2 =   1.0 - alpha;
    SBiquad bi;
    bi.b0 = b0 / a0;
    bi.b1 = b1 / a0;
    bi.b2 = b2 / a0;
    bi.a1 = a1 / a0;
    bi.a2 = a2 / a0;
    for (int i = 0; i < sections; ++i) chain.push_back(bi);
    return chain;
}

// helpers (local)
static inline double meanVec(const std::vector<double>& v) {
    if (v.empty()) return 0.0; double s = 0.0; for (double x : v) s += x; return s / static_cast<double>(v.size());
}
static inline double std_pop_vec(const std::vector<double>& v) {
    if (v.empty()) return 0.0; double m = meanVec(v); double acc = 0.0; for (double x : v) { double d = x - m; acc += d * d; } return acc / static_cast<double>(v.size());
}
static inline double round6_local(double x) { return std::round(x * 1e6) / 1e6; }

RealtimeAnalyzer::RealtimeAnalyzer(double fs, const Options& opt)
    : fs_(fs), opt_(opt) {
    if (fs_ <= 0.0) fs_ = 50.0;
    if (windowSec_ < 1.0) windowSec_ = 10.0;
    if (updateSec_ <= 0.0) updateSec_ = 1.0;
    signal_.reserve(static_cast<size_t>(windowSec_ * fs_) + 8 * static_cast<size_t>(fs_));
    effectiveFs_ = fs_;
    firstTsApprox_ = 0.0;
    lastTs_ = 0.0;
    // Streaming filter design
    if (opt_.lowHz > 0.0 || opt_.highHz > 0.0) {
        bq_ = designBandpassStream(fs_, opt_.lowHz, opt_.highHz, std::max(1, opt_.iirOrder));
    }
    // Rolling stats window ~0.75s
    winSamples_ = std::max(5, static_cast<int>(std::lround(0.75 * fs_)));
    refractorySamples_ = std::max(1, static_cast<int>(std::lround((opt_.refractoryMs * 0.001) * fs_)));
    firstAbs_ = 0;
    totalAbs_ = 0;
    rollSum_ = 0.0;
    rollSumSq_ = 0.0;
}

void RealtimeAnalyzer::setWindowSeconds(double sec) {
    windowSec_ = std::max(1.0, sec);
    trimToWindow();
}

void RealtimeAnalyzer::setUpdateIntervalSeconds(double sec) {
    updateSec_ = std::max(0.1, sec);
}

void RealtimeAnalyzer::append(const float* x, size_t n) {
    if (!x || n == 0) return;
    // Append and process new samples incrementally
    const size_t prevLen = signal_.size();
    signal_.insert(signal_.end(), x, x + n);
    const size_t newLen = signal_.size();
    if (filt_.size() < prevLen) filt_.resize(prevLen);
    if (signal_.size() > filt_.size()) filt_.resize(signal_.size());
    // timebase (nominal fs)
    if (prevLen == 0) { firstTsApprox_ = 0.0; lastTs_ = static_cast<double>(n) / fs_; }
    else lastTs_ += static_cast<double>(n) / fs_;
    // Process new portion
    for (size_t i = prevLen; i < newLen; ++i) {
        float s = signal_[i];
        float y = s;
        for (auto &bi : bq_) y = bi.process(y);
        filt_[i] = y;
        // rolling window update
        rollWin_.push_back(y);
        rollSum_ += y;
        rollSumSq_ += static_cast<double>(y) * static_cast<double>(y);
        while ((int)rollWin_.size() > winSamples_) {
            float u = rollWin_.front(); rollWin_.pop_front();
            rollSum_ -= u; rollSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
        }
        // incremental local-max detection using 1-sample look-ahead
        size_t k = i;
        if (k >= 2) {
            float y2 = filt_[k - 2];
            float y1 = filt_[k - 1];
            float y0 = filt_[k - 0];
            if (y1 > y2 && y1 >= y0) {
                int nwin = static_cast<int>(rollWin_.size());
                double mean = (nwin > 0 ? (rollSum_ / nwin) : 0.0);
                double var = (nwin > 0 ? (rollSumSq_ / nwin - mean * mean) : 0.0);
                if (var < 0.0) var = 0.0; double sd = std::sqrt(var);
                double thr = mean + opt_.thresholdScale * sd;
                // absolute sample index of y1
                size_t absIdx = firstAbs_ + (k - 1);
                if (y1 > thr) {
                    if (peaksAbs_.empty() || ((absIdx - peaksAbs_.back()) >= static_cast<size_t>(refractorySamples_))) {
                        peaksAbs_.push_back(absIdx);
                    }
                }
            }
        }
        ++totalAbs_;
    }
    // Rebuild downsampled display buffer (simple decimation)
    const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    int stride = std::max(1, (int)std::lround(effFs / std::max(10.0, displayHz_)));
    displayBuf_.clear(); displayBuf_.reserve(filt_.size() / stride + 1);
    for (size_t idx = 0; idx < filt_.size(); idx += (size_t)stride) displayBuf_.push_back(filt_[idx]);
    trimToWindow();
}

void RealtimeAnalyzer::trimToWindow() {
    const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    const size_t maxSamples = static_cast<size_t>(windowSec_ * effFs);
    if (signal_.size() > maxSamples) {
        const size_t drop = signal_.size() - maxSamples;
        signal_.erase(signal_.begin(), signal_.begin() + drop);
        if (filt_.size() >= drop) filt_.erase(filt_.begin(), filt_.begin() + drop);
        // Approximate firstTs by backing off from lastTs
        firstTsApprox_ = lastTs_ - static_cast<double>(signal_.size()) / effFs;
        firstAbs_ += drop;
        // prune peaks outside window; rebuild RR/peaks relative indices
        while (!peaksAbs_.empty() && peaksAbs_.front() < firstAbs_) peaksAbs_.erase(peaksAbs_.begin());
        lastPeaks_.clear(); lastRR_.clear();
        for (size_t j = 0; j < peaksAbs_.size(); ++j) {
            size_t rel = peaksAbs_[j] - firstAbs_;
            lastPeaks_.push_back(static_cast<int>(rel));
            if (j > 0) {
                double dt = static_cast<double>(peaksAbs_[j] - peaksAbs_[j - 1]) / effFs;
                lastRR_.push_back(dt * 1000.0);
            }
        }
    }
    // Trim display buffer to the same time window length in seconds
    const size_t maxDisp = static_cast<size_t>(windowSec_ * std::max(10.0, displayHz_));
    if (displayBuf_.size() > maxDisp) {
        const size_t drop = displayBuf_.size() - maxDisp;
        displayBuf_.erase(displayBuf_.begin(), displayBuf_.begin() + drop);
    }
}

void RealtimeAnalyzer::push(const float* samples, size_t n, double /*t0*/) {
    append(samples, n);
}

void RealtimeAnalyzer::push(const std::vector<double>& samples, double /*t0*/) {
    if (samples.empty()) return;
    std::vector<float> tmp(samples.size());
    for (size_t i = 0; i < samples.size(); ++i) tmp[i] = static_cast<float>(samples[i]);
    append(tmp.data(), tmp.size());
}

void RealtimeAnalyzer::push(const float* samples, const double* timestamps, size_t n) {
    if (!samples || !timestamps || n == 0) return;
    // Append samples
    signal_.insert(signal_.end(), samples, samples + n);
    // Update effective Fs using batch average dt
    if (n >= 2) {
        double t0 = timestamps[0];
        double t1 = timestamps[n - 1];
        double dt = (t1 - t0) / static_cast<double>(n - 1);
        if (dt > 1e-6) {
            double fsBatch = 1.0 / dt;
            if (effectiveFs_ <= 0.0) effectiveFs_ = fsBatch;
            else effectiveFs_ = (1.0 - emaAlpha_) * effectiveFs_ + emaAlpha_ * fsBatch;
        }
        if (signal_.size() == n) firstTsApprox_ = t0;
        lastTs_ = t1;
    } else {
        double dt = (effectiveFs_ > 0.0) ? (1.0 / effectiveFs_) : (1.0 / fs_);
        if (signal_.size() == n) firstTsApprox_ = timestamps[0];
        lastTs_ = timestamps[0] + dt;
    }
    displayBuf_ = signal_;
    trimToWindow();
}

bool RealtimeAnalyzer::poll(HeartMetrics& out) {
    // Only emit once per updateSec_ of newly received samples
    if ((lastTs_ - lastEmitTime_) < updateSec_) return false;
    lastEmitTime_ = lastTs_;

    // Batch fallback: analyze the current sliding window via analyzeSignal()
    if (signal_.empty()) return false;
    std::vector<double> win; win.reserve(signal_.size());
    for (float v : displayBuf_) win.push_back(static_cast<double>(v));
    Options o = opt_;
    // Keep user-configured bandpass; callers may set lowHz=highHz=0 to skip
    const double fsEff = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    out = analyzeSignal(win, fsEff, o);

    // Cache a few items for convenience
    lastQuality_ = out.quality;
    // Keep incremental peaks/RR from streaming path; if empty, fall back to batch results
    if (lastPeaks_.empty()) lastPeaks_ = out.peakList;
    if (lastRR_.empty()) lastRR_ = out.rrList;

    // Phase S4: compute masked metrics incrementally from streaming RR list
    if (!lastRR_.empty()) {
        const std::vector<double>& rr_ms = lastRR_;
        std::vector<int> rr_mask(rr_ms.size(), 0);
        if (opt_.thresholdRR && rr_ms.size() >= 1) {
            double mean_rr = meanVec(rr_ms);
            double margin = std::max(0.3 * mean_rr, 300.0);
            double lower = mean_rr - margin;
            double upper = mean_rr + margin;
            for (size_t i = 0; i < rr_ms.size(); ++i) {
                if (rr_ms[i] <= lower || rr_ms[i] >= upper) rr_mask[i] = 1; // reject
            }
        }
        // successive diffs only where both ends are accepted
        std::vector<double> pair_diffs; pair_diffs.reserve(rr_ms.size());
        std::vector<double> pair_abs; pair_abs.reserve(rr_ms.size());
        for (size_t i = 1; i < rr_ms.size(); ++i) {
            if (rr_mask[i] == 0 && rr_mask[i - 1] == 0) {
                double d = rr_ms[i] - rr_ms[i - 1];
                pair_diffs.push_back(d);
                pair_abs.push_back(std::fabs(d));
            }
        }
        if (!pair_abs.empty()) {
            // SDSD & RMSSD
            if (opt_.sdsdMode == Options::SdsdMode::ABS) out.sdsd = std::sqrt(std_pop_vec(pair_abs));
            else out.sdsd = std::sqrt(std_pop_vec(pair_diffs));
            double sumsq = 0.0; for (double d : pair_diffs) sumsq += d * d; out.rmssd = std::sqrt(sumsq / static_cast<double>(pair_diffs.size()));
            // pNN
            int over20 = 0, over50 = 0;
            for (double a : pair_abs) {
                double v = round6_local(a);
                if (v > 20.0) ++over20;
                if (v > 50.0) ++over50;
            }
            out.nn20 = over20; out.nn50 = over50;
            double r20 = over20 / static_cast<double>(pair_abs.size());
            double r50 = over50 / static_cast<double>(pair_abs.size());
            out.pnn20 = opt_.pnnAsPercent ? (100.0 * r20) : r20;
            out.pnn50 = opt_.pnnAsPercent ? (100.0 * r50) : r50;
        }
        // update simple quality counters using mask
        out.quality.totalBeats = static_cast<int>(rr_ms.size() + 1);
        int rej = 0; for (int m : rr_mask) if (m) ++rej;
        out.quality.rejectedBeats = rej;
        out.quality.rejectionRate = (rr_ms.size() > 0 ? (rej / static_cast<double>(rr_ms.size())) : 0.0);

        // Phase S5: build 10-beat sliding binary windows (BinarySegments)
        out.binarySegments.clear();
        int windowBeats = 10; // default
        if (opt_.segmentRejectWindowBeats > 0) windowBeats = opt_.segmentRejectWindowBeats;
        int maxRejects = std::max(0, opt_.segmentRejectMaxRejects);
        const int beats = static_cast<int>(rr_ms.size() + 1);
        // rr_mask is per interval; window intervals = windowBeats - 1
        const int winIntervals = std::max(0, windowBeats - 1);
        if (beats >= windowBeats && winIntervals > 0) {
            int idx = 0;
            for (int b0 = 0; b0 + windowBeats <= beats; ++b0) {
                int b1 = b0 + windowBeats; // exclusive beat end
                int i0 = b0;               // interval start index
                int i1 = b1 - 1;           // interval end (exclusive)
                int rcount = 0;
                for (int i = i0; i < i1 && i < (int)rr_mask.size(); ++i) if (rr_mask[i]) ++rcount;
                HeartMetrics::BinarySegment seg;
                seg.index = idx++;
                seg.startBeat = b0;
                seg.endBeat = b1;
                seg.totalBeats = windowBeats;
                seg.rejectedBeats = rcount;
                seg.accepted = (rcount <= maxRejects);
                out.binarySegments.push_back(seg);
            }
        }
    }
    // Phase S6: compute breathing + SNR/Confidence periodically
    updateSNR(out);
    return true;
}

} // namespace heartpy

// Plain C bridge
struct _hp_rt_handle { heartpy::RealtimeAnalyzer* p; };

void* hp_rt_create(double fs, const heartpy::Options* opt) {
    auto* h = new _hp_rt_handle();
    heartpy::Options o = opt ? *opt : heartpy::Options{};
    h->p = new heartpy::RealtimeAnalyzer(fs, o);
    return h;
}

void  hp_rt_set_window(void* h, double sec) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->setWindowSeconds(sec);
}

void  hp_rt_set_update_interval(void* h, double sec) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->setUpdateIntervalSeconds(sec);
}

void  hp_rt_push(void* h, const float* x, size_t n, double t0) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); S->p->push(x, n, t0);
}

int   hp_rt_poll(void* h, heartpy::HeartMetrics* out) {
    if (!h || !out) return 0; auto* S = reinterpret_cast<_hp_rt_handle*>(h); return S->p->poll(*out) ? 1 : 0;
}

void  hp_rt_destroy(void* h) {
    if (!h) return; auto* S = reinterpret_cast<_hp_rt_handle*>(h); delete S->p; delete S;
}

namespace heartpy {

void RealtimeAnalyzer::updateSNR(HeartMetrics& out) {
    if ((lastTs_ - lastPsdTime_) < psdUpdateSec_) return;
    lastPsdTime_ = lastTs_;
    const double fsResamp = 4.0;
    const double dt = 1.0 / fsResamp;
    const double tStart = lastTs_ - windowSec_;
    const double tEnd = lastTs_;
    const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    if (displayBuf_.size() < 8 || effFs <= 0.0) return;
    const size_t n = displayBuf_.size();
    auto interp = [&](double tsec){
        double rel = (tsec - firstTsApprox_) * effFs;
        if (rel <= 0.0) return (double)displayBuf_.front();
        if (rel >= (double)(n - 1)) return (double)displayBuf_.back();
        size_t i = (size_t)rel;
        double frac = rel - (double)i;
        double y0 = displayBuf_[i];
        double y1 = displayBuf_[i + 1];
        return y0 + frac * (y1 - y0);
    };
    int m = std::max(8, (int)std::floor((tEnd - tStart) * fsResamp));
    std::vector<double> y; y.reserve(m);
    for (int i = 0; i < m; ++i) {
        double t = tStart + i * dt;
        y.push_back(interp(t));
    }
    auto ps = welchPowerSpectrum(y, fsResamp, 256, 0.5);
    const auto &frq = ps.first; const auto &P = ps.second;
    if (frq.size() < 4 || frq.size() != P.size()) return;
    double f0 = 0.0, vmax = -1.0;
    for (size_t i = 0; i < frq.size(); ++i) {
        double f = frq[i];
        if (f >= 0.10 && f <= 0.40 && P[i] > vmax) { vmax = P[i]; f0 = f; }
    }
    if (f0 > 0.0) out.breathingRate = opt_.breathingAsBpm ? (f0 * 60.0) : f0;
    auto inBand = [&](double f, double c, double bw){ return std::fabs(f - c) <= bw; };
    double df = (frq.size() > 1 ? frq[1] - frq[0] : 0.0);
    double Psig = 0.0, Pnoise = 0.0;
    for (size_t i = 0; i < frq.size(); ++i) {
        double f = frq[i];
        bool sigBin = false;
        if (f0 > 0.0) {
            if (inBand(f, f0, 0.05)) sigBin = true;
            double f2 = 2.0 * f0; if (f2 <= (fsResamp * 0.5) && inBand(f, f2, 0.05)) sigBin = true;
        }
        if (sigBin) Psig += std::abs(P[i]) * df; else if (f >= 0.4 && f <= 5.0) Pnoise += std::abs(P[i]) * df;
    }
    double snrDb = (Psig > 0.0 && Pnoise > 0.0) ? (10.0 * std::log10(Psig / Pnoise)) : 0.0;
    out.quality.snrDb = snrDb;
    double conf = std::max(0.0, std::min(1.0, (snrDb - 3.0) / (12.0 - 3.0)));
    conf *= (1.0 - out.quality.rejectionRate);
    out.quality.confidence = conf;
}

} // namespace heartpy
