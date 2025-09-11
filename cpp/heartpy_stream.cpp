#include "heartpy_stream.h"
#include <algorithm>
#include <deque>
#include <cmath>

namespace heartpy {

// Local HP-style helpers (mirrors core behavior, kept local to avoid linkage deps)
static std::vector<double> rollingMeanHP_local(const std::vector<double>& data, double fs, double windowSeconds) {
    const int N = static_cast<int>(windowSeconds * fs);
    const int n = static_cast<int>(data.size());
    if (N <= 1 || n == 0 || N > n) {
        double ssum = 0.0; for (double v : data) ssum += v; double m = (n > 0 ? (ssum / n) : 0.0);
        return std::vector<double>(n, m);
    }
    std::vector<double> rol; rol.reserve(n - N + 1);
    double s = 0.0; for (int i = 0; i < N; ++i) s += data[i];
    rol.push_back(s / N);
    for (int i = N; i < n; ++i) { s += data[i]; s -= data[i - N]; rol.push_back(s / N); }
    int n_miss = static_cast<int>(std::abs(n - static_cast<int>(rol.size())) / 2);
    std::vector<double> out; out.reserve(n);
    for (int i = 0; i < n_miss; ++i) out.push_back(rol.front());
    out.insert(out.end(), rol.begin(), rol.end());
    while ((int)out.size() < n) out.push_back(rol.back());
    if ((int)out.size() > n) out.resize(n);
    return out;
}

static std::vector<int> detectPeaksHP_local(const std::vector<double>& x, const std::vector<double>& rol_mean, double ma_perc, double fs) {
    const int n = static_cast<int>(x.size());
    if (n == 0 || (int)rol_mean.size() != n) return {};
    double ssum = 0.0; for (double v : rol_mean) ssum += v; double mn = ((rol_mean.empty() ? 0.0 : (ssum / (double)rol_mean.size())) / 100.0) * ma_perc;
    std::vector<double> thr(n);
    for (int i = 0; i < n; ++i) thr[i] = rol_mean[i] + mn;
    std::vector<int> maskIdx; maskIdx.reserve(n);
    for (int i = 0; i < n; ++i) if (x[i] > thr[i]) maskIdx.push_back(i);
    if (maskIdx.empty()) return {};
    std::vector<int> edges; edges.push_back(0);
    for (size_t i = 1; i < maskIdx.size(); ++i) if (maskIdx[i] - maskIdx[i-1] > 1) edges.push_back((int)i);
    edges.push_back((int)maskIdx.size());
    std::vector<int> peaklist; peaklist.reserve(edges.size());
    for (size_t e = 0; e + 1 < edges.size(); ++e) {
        int a = edges[e], b = edges[e+1]; if (a >= b) continue;
        int best_idx = maskIdx[a]; double best_val = x[best_idx];
        for (int j = a + 1; j < b; ++j) { int idx = maskIdx[j]; if (x[idx] > best_val) { best_val = x[idx]; best_idx = idx; } }
        peaklist.push_back(best_idx);
    }
    if (!peaklist.empty()) {
        if (peaklist[0] <= (int)((fs / 1000.0) * 150.0)) peaklist.erase(peaklist.begin());
    }
    return peaklist;
}

// Collapse peaks closer than refractory to the strongest amplitude
static std::vector<int> consolidateByRefractory(const std::vector<int>& peaks,
                                                const std::vector<double>& x,
                                                int refractorySamples) {
    if (peaks.empty()) return {};
    std::vector<int> out;
    int current = peaks[0];
    double currentVal = x[current];
    for (size_t i = 1; i < peaks.size(); ++i) {
        int p = peaks[i];
        if (p - current <= refractorySamples) {
            // within refractory window: keep the stronger
            if (x[p] > currentVal) { current = p; currentVal = x[p]; }
        } else {
            out.push_back(current);
            current = p;
            currentVal = x[p];
        }
    }
    out.push_back(current);
    return out;
}

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
    // HP thresholding state
    maPerc_ = std::max(10.0, std::min(60.0, opt_.maPerc));
    hpThreshold_ = opt_.useHPThreshold;
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
        // rectified update for thresholding
        {
            float yr = std::max(0.0f, y);
            rollWinRect_.push_back(yr);
            rollRectSum_ += yr;
            rollRectSumSq_ += static_cast<double>(yr) * static_cast<double>(yr);
        }
        while ((int)rollWin_.size() > winSamples_) {
            float u = rollWin_.front(); rollWin_.pop_front();
            rollSum_ -= u; rollSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
        }
        while ((int)rollWinRect_.size() > winSamples_) {
            float u = rollWinRect_.front(); rollWinRect_.pop_front();
            rollRectSum_ -= u; rollRectSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
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
                double thr;
                double y1Cmp = y1;
                if (hpThreshold_) {
                    // Positive-baseline scaling over the rolling window [0..1024]
                    double vmin = y1, vmax = y1;
                    for (float vv : rollWin_) { if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv; }
                    double den = std::max(1e-6, vmax - vmin);
                    double scaledMean = (mean - vmin) / den * 1024.0;
                    // temporary lift boost window (if applicable)
                    const double effFsLocThr = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
                    size_t testAbs = firstAbs_ + (k - 1);
                    double tnowThr = firstTsApprox_ + ((double)(testAbs - firstAbs_)) / effFsLocThr;
                    double lift = baseLift_ + ((tnowThr < tempLiftUntil_) ? tempLiftBoost_ : 0.0);
                    thr = scaledMean + lift;
                    y1Cmp = (y1 - vmin) / den * 1024.0;
                } else {
                    thr = mean + (opt_.thresholdScale * sd);
                }
                // absolute sample index of y1
                size_t absIdx = firstAbs_ + (k - 1);
                if (y1Cmp > thr) {
                    // RR-predicted gating
                    const double effFsLoc = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
                    bool allowPeak = true;
                    if (!peaksAbs_.empty()) {
                        size_t lastAbs = peaksAbs_.back();
                        double rr_new_ms = (double)(absIdx - lastAbs) / effFsLoc * 1000.0;
                        double tnow = firstTsApprox_ + ((double)(absIdx - firstAbs_)) / effFsLoc;
                        double bpm_prior = bpmEmaValid_ ? bpmEma_ : (0.5 * (opt_.bpmMin + opt_.bpmMax));
                        bpm_prior = std::max(opt_.bpmMin, std::min(opt_.bpmMax, bpm_prior));
                        double rr_prior_ms = std::max(opt_.minRRFloorRelaxed, std::min(opt_.minRRCeiling, 60000.0 / std::max(1e-6, bpm_prior)));
                        int acceptedRR = std::max(0, (int)acceptedPeaksTotal_ - 1);
                        bool gateRel = (tnow >= 15.0) && (acceptedRR >= 10) && (bpmEmaValid_ && bpmEma_ < 100.0);
                        double floor_ms = gateRel ? opt_.minRRFloorRelaxed : opt_.minRRFloorStrict;
                        double min_rr_ms = std::max(0.7 * rr_prior_ms, floor_ms);
                        // Unified long-RR gating when soft/hard/hint is active
                        if (softDoublingActive_ || doublingActive_ || doublingHintActive_) {
                            double longEst = 0.0;
                            if (doublingLongRRms_ > 0.0) longEst = std::max(longEst, doublingLongRRms_);
                            if (!lastRR_.empty()) {
                                std::vector<double> tmpRR = lastRR_;
                                std::nth_element(tmpRR.begin(), tmpRR.begin() + tmpRR.size()/2, tmpRR.end());
                                double med = tmpRR[tmpRR.size()/2];
                                longEst = std::max(longEst, 2.0 * med);
                            }
                            if (lastF0Hz_ > 1e-9) longEst = std::max(longEst, 1000.0 / lastF0Hz_);
                            if (longEst > 0.0) {
                                longEst = std::clamp(longEst, 600.0, opt_.minRRCeiling);
                                double minSoft = std::clamp(opt_.minRRGateFactor * longEst, opt_.minRRFloorRelaxed, opt_.minRRCeiling);
                                min_rr_ms = std::max(min_rr_ms, minSoft);
                                // Hard doubling fallback bounds folded here for coherence
                                if (doublingActive_ && (doublingLongRRms_ > 0.0)) {
                                    if (tnow <= hardFallbackUntil_) {
                                        min_rr_ms = std::max(min_rr_ms, 0.9 * doublingLongRRms_);
                                    } else if (tnow < doublingHoldUntil_) {
                                        min_rr_ms = std::max(min_rr_ms, 0.8 * doublingLongRRms_);
                                    }
                                }
                            }
                        }
                        if (rr_new_ms < min_rr_ms) {
                            // strongest exception
                            size_t relLast = lastAbs >= firstAbs_ ? (lastAbs - firstAbs_) : 0;
                            float lastVal = (relLast < filt_.size() ? filt_[relLast] : y1);
                            double lastCmp = lastVal;
                            if (hpThreshold_) {
                                double vmin2 = y1, vmax2 = y1; for (float vv : rollWin_) { if (vv < vmin2) vmin2 = vv; if (vv > vmax2) vmax2 = vv; }
                                double den2 = std::max(1e-6, vmax2 - vmin2);
                                lastCmp = (lastVal - vmin2) / den2 * 1024.0;
                            }
                            if (!(y1Cmp > lastCmp + 1.0 * sd)) allowPeak = false;
                        }
                        // Rejection tracking and temporary lift/refractory bias
                        
                        if (!allowPeak) {
                            if ((tnow - shortRejectWindowStart_) > 3.0) { shortRejectWindowStart_ = tnow; shortRejectCount_ = 0; }
                            ++shortRejectCount_;
                            if (shortRejectCount_ > 3) {
                                tempLiftBoost_ = std::max(tempLiftBoost_, 10.0);
                                tempLiftUntil_ = tnow + 2.0;
                                int capExtra = (int)std::lround(std::max(0.0, 0.35 - (opt_.refractoryMs * 0.001)) * effFsLoc);
                                dynRefExtraSamples_ = std::min(std::max(dynRefExtraSamples_, (int)std::lround(0.05 * effFsLoc)), capExtra);
                                dynRefUntil_ = tnow + 2.0;
                            }
                        }
                        if (tnow > dynRefUntil_) dynRefExtraSamples_ = 0;
                        // Diagnostics: track applied refractory and min-RR bound in this path
                        int dynBaseRef = (int)std::lround(std::clamp(0.4 * rr_prior_ms, 280.0, 450.0) * 0.001 * effFsLoc);
                        int appliedRef = dynBaseRef + dynRefExtraSamples_;
                        double tcur = tnow;
                        if (doublingActive_ && (tcur <= hardFallbackUntil_)) {
                            int fallbackRef = (int)std::lround(std::min(450.0, 0.5 * rr_prior_ms) * 0.001 * effFsLoc);
                            appliedRef = std::max(appliedRef, fallbackRef);
                        }
                        lastRefMsActive_ = appliedRef * 1000.0 / effFsLoc;
                        lastMinRRBoundMs_ = min_rr_ms;
                    }
                    if (allowPeak) {
                        if (peaksAbs_.empty()) {
                            peaksAbs_.push_back(absIdx);
                            lastAcceptedAmpCmp_ = y1Cmp;
                            ++acceptedPeaksTotal_;
                        } else {
                            size_t lastAbs = peaksAbs_.back();
                            // dynamic base refractory + temporary extras, with hard fallback boost
                            double bpm_prior2 = bpmEmaValid_ ? bpmEma_ : (0.5 * (opt_.bpmMin + opt_.bpmMax));
                            double rr_prior_ms2 = std::max(400.0, std::min(1200.0, 60000.0 / std::max(1e-6, bpm_prior2)));
                            int baseRef2 = (int)std::lround(std::clamp(0.4 * rr_prior_ms2, 280.0, 450.0) * 0.001 * effFsLoc);
                            int refractoryNow = std::max(1, baseRef2) + dynRefExtraSamples_;
                            double tcur2 = firstTsApprox_ + ((double)(absIdx - firstAbs_)) / effFsLoc;
                            if (doublingActive_ && (tcur2 <= hardFallbackUntil_)) {
                                int fallbackRef = (int)std::lround(std::min(450.0, 0.5 * rr_prior_ms2) * 0.001 * effFsLoc);
                                refractoryNow = std::max(refractoryNow, fallbackRef);
                            }
                            if ((absIdx - lastAbs) >= (size_t)std::max(1, refractoryNow)) {
                                peaksAbs_.push_back(absIdx);
                                lastAcceptedAmpCmp_ = y1Cmp;
                                ++acceptedPeaksTotal_;
                            } else {
                                // strongest-within-refractory: replace if stronger
                                size_t relLast = lastAbs >= firstAbs_ ? (lastAbs - firstAbs_) : 0;
                                float lastVal = (relLast < filt_.size() ? filt_[relLast] : y1);
                                double lastCmp = lastVal;
                                if (hpThreshold_) {
                                    double vmin = y1, vmax = y1; for (float vv : rollWin_) { if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv; }
                                    double den2 = std::max(1e-6, vmax - vmin);
                                    lastCmp = (lastVal - vmin) / den2 * 1024.0;
                                }
                                if (y1Cmp > lastCmp) peaksAbs_.back() = absIdx;
                            }
                        }
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
    // Update effective Fs using timestamps
    double t0 = timestamps[0];
    double t1 = timestamps[n - 1];
    if (n >= 2) {
        double dt = (t1 - t0) / static_cast<double>(n - 1);
        if (dt > 1e-6) {
            double fsBatch = 1.0 / dt;
            if (effectiveFs_ <= 0.0) effectiveFs_ = fsBatch;
            else effectiveFs_ = (1.0 - emaAlpha_) * effectiveFs_ + emaAlpha_ * fsBatch;
        }
    }
    if (signal_.empty()) firstTsApprox_ = t0;
    lastTs_ = t1;
    // Process each incoming sample through the same path as append()
    const size_t prevLen = signal_.size();
    signal_.insert(signal_.end(), samples, samples + n);
    if (filt_.size() < prevLen) filt_.resize(prevLen);
    if (signal_.size() > filt_.size()) filt_.resize(signal_.size());
    for (size_t i = 0; i < n; ++i) {
        size_t dst = prevLen + i;
        float s = samples[i];
        float y = s;
        for (auto &bi : bq_) y = bi.process(y);
        filt_[dst] = y;
        // rolling window update
        rollWin_.push_back(y);
        rollSum_ += y;
        rollSumSq_ += static_cast<double>(y) * static_cast<double>(y);
        // rectified window update for HP-style thresholding
        {
            float yr = std::max(0.0f, y);
            rollWinRect_.push_back(yr);
            rollRectSum_ += yr;
            rollRectSumSq_ += static_cast<double>(yr) * static_cast<double>(yr);
        }
        while ((int)rollWin_.size() > winSamples_) {
            float u = rollWin_.front(); rollWin_.pop_front();
            rollSum_ -= u; rollSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
        }
        while ((int)rollWinRect_.size() > winSamples_) {
            float u = rollWinRect_.front(); rollWinRect_.pop_front();
            rollRectSum_ -= u; rollRectSumSq_ -= static_cast<double>(u) * static_cast<double>(u);
        }
        // incremental local-max detection using 1-sample look-ahead
        if (dst >= 2) {
            float y2 = std::max(0.0f, filt_[dst - 2]);
            float y1 = std::max(0.0f, filt_[dst - 1]);
            float y0 = std::max(0.0f, filt_[dst - 0]);
            if (y1 > y2 && y1 >= y0) {
                int nwin = static_cast<int>(rollWinRect_.size());
                double mean = (nwin > 0 ? (rollRectSum_ / nwin) : 0.0);
                double var = (nwin > 0 ? (rollRectSumSq_ / nwin - mean * mean) : 0.0);
                if (var < 0.0) var = 0.0; double sd = std::sqrt(var);
                double thr;
                double y1Cmp = y1;
                if (hpThreshold_) {
                    double vmin = y1, vmax = y1; for (float vv : rollWinRect_) { if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv; }
                    double den = std::max(1e-6, vmax - vmin);
                    double scaledMean = (mean - vmin) / den * 1024.0;
                    const double effFsLocThr = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
                    size_t testAbs = firstAbs_ + (dst - 1);
                    double tnowThr = firstTsApprox_ + ((double)(testAbs - firstAbs_)) / effFsLocThr;
                    double lift = baseLift_ + ((tnowThr < tempLiftUntil_) ? tempLiftBoost_ : 0.0);
                    thr = scaledMean + lift;
                    y1Cmp = (y1 - vmin) / den * 1024.0;
                } else {
                    thr = mean + (opt_.thresholdScale * sd);
                }
                size_t absIdx = firstAbs_ + (dst - 1);
                if (y1Cmp > thr) {
                    // RR-predicted gating (timestamped path)
                    const double effFsLoc = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
                    bool allowPeak = true;
                    if (!peaksAbs_.empty()) {
                        size_t lastAbs = peaksAbs_.back();
                        double rr_new_ms = (double)(absIdx - lastAbs) / effFsLoc * 1000.0;
                        double tnow = firstTsApprox_ + ((double)(absIdx - firstAbs_)) / effFsLoc;
                        double bpm_prior = bpmEmaValid_ ? bpmEma_ : (0.5 * (opt_.bpmMin + opt_.bpmMax));
                        bpm_prior = std::max(opt_.bpmMin, std::min(opt_.bpmMax, bpm_prior));
                        double rr_prior_ms = std::max(opt_.minRRFloorRelaxed, std::min(opt_.minRRCeiling, 60000.0 / std::max(1e-6, bpm_prior)));
                        int acceptedRR = std::max(0, (int)acceptedPeaksTotal_ - 1);
                        bool gateRel = (tnow >= 15.0) && (acceptedRR >= 10) && (bpmEmaValid_ && bpmEma_ < 100.0);
                        double floor_ms = gateRel ? opt_.minRRFloorRelaxed : opt_.minRRFloorStrict;
                        double min_rr_ms = std::max(0.7 * rr_prior_ms, floor_ms);
                        if (rr_new_ms < min_rr_ms) {
                            size_t relLast = lastAbs >= firstAbs_ ? (lastAbs - firstAbs_) : 0;
                            float lastVal = (relLast < filt_.size() ? std::max(0.0f, filt_[relLast]) : y1);
                            double lastCmp = lastVal;
                            if (hpThreshold_) {
                                double vmin2 = y1, vmax2 = y1; for (float vv : rollWinRect_) { if (vv < vmin2) vmin2 = vv; if (vv > vmax2) vmax2 = vv; }
                                double den2 = std::max(1e-6, vmax2 - vmin2);
                                lastCmp = (lastVal - vmin2) / den2 * 1024.0;
                            }
                            double margin = gateRel ? 1.0 : 2.5;
                            if (!(y1Cmp > lastCmp + margin * sd)) allowPeak = false;
                        }
                        // dynamic refractory base tied to prior RR
                        int dynBaseRef = (int)std::lround(std::clamp(0.4 * rr_prior_ms, 280.0, 450.0) * 0.001 * effFsLoc);
                        // Rejection tracking and temporary lift/refractory bias
                        if (!allowPeak) {
                            if ((tnow - shortRejectWindowStart_) > 3.0) { shortRejectWindowStart_ = tnow; shortRejectCount_ = 0; }
                            ++shortRejectCount_;
                            if (shortRejectCount_ > 3) {
                                tempLiftBoost_ = std::max(tempLiftBoost_, 10.0);
                                tempLiftUntil_ = tnow + 2.0;
                                int capExtra = (int)std::lround(std::max(0.0, 0.35 - (opt_.refractoryMs * 0.001)) * effFsLoc);
                                dynRefExtraSamples_ = std::min(std::max(dynRefExtraSamples_, (int)std::lround(0.05 * effFsLoc)), capExtra);
                                dynRefUntil_ = tnow + 2.0;
                            }
                        }
                        if (tnow > dynRefUntil_) dynRefExtraSamples_ = 0;
                        // Track diagnostics for logging (applied refractory and min RR)
                        int appliedRef = dynBaseRef + dynRefExtraSamples_;
                        double tcur = firstTsApprox_ + ((double)(absIdx - firstAbs_)) / effFsLoc;
                        if (doublingActive_ && (tcur <= hardFallbackUntil_)) {
                            int fallbackRef = (int)std::lround(std::min(450.0, 0.5 * rr_prior_ms) * 0.001 * effFsLoc);
                            appliedRef = std::max(appliedRef, fallbackRef);
                        }
                        lastRefMsActive_ = appliedRef * 1000.0 / effFsLoc;
                        lastMinRRBoundMs_ = min_rr_ms;
                        // trough requirement between peaks
                        if (allowPeak) {
                            int start = (int)std::max((size_t)firstAbs_, lastAbs);
                            int end = (int)(absIdx);
                            double vmin2 = y1, vmax2 = y1; for (float vv : rollWinRect_) { if (vv < vmin2) vmin2 = vv; if (vv > vmax2) vmax2 = vv; }
                            double den2 = std::max(1e-6, vmax2 - vmin2);
                            double delta = 140.0;
                            double minCmp = 1e9;
                            for (int idx = start; idx < end; ++idx) {
                                float yr2 = std::max(0.0f, filt_[idx - (int)firstAbs_]);
                                double cmp = (yr2 - vmin2) / den2 * 1024.0;
                                if (cmp < minCmp) minCmp = cmp;
                            }
                            if (!(minCmp < (thr - delta))) allowPeak = false;
                        }
                    }
                    if (allowPeak) {
                        if (peaksAbs_.empty()) {
                            peaksAbs_.push_back(absIdx);
                            ++acceptedPeaksTotal_;
                        } else {
                            size_t lastAbs = peaksAbs_.back();
                            // recompute dynamic base refractory here
                            double bpm_prior2 = bpmEmaValid_ ? bpmEma_ : (0.5 * (opt_.bpmMin + opt_.bpmMax));
                            double rr_prior_ms2 = std::max(400.0, std::min(1200.0, 60000.0 / std::max(1e-6, bpm_prior2)));
                            int baseRef2 = (int)std::lround(std::clamp(0.4 * rr_prior_ms2, 280.0, 450.0) * 0.001 * effFsLoc);
                            int refractoryNow = std::max(1, baseRef2) + dynRefExtraSamples_;
                            double tcur2 = firstTsApprox_ + ((double)(absIdx - firstAbs_)) / effFsLoc;
                            if (doublingActive_ && (tcur2 <= hardFallbackUntil_)) {
                                int fallbackRef = (int)std::lround(std::min(450.0, 0.5 * rr_prior_ms2) * 0.001 * effFsLoc);
                                refractoryNow = std::max(refractoryNow, fallbackRef);
                            }
                            if ((absIdx - lastAbs) >= (size_t)std::max(1, refractoryNow)) {
                                peaksAbs_.push_back(absIdx);
                                ++acceptedPeaksTotal_;
                            } else {
                                size_t relLast = lastAbs >= firstAbs_ ? (lastAbs - firstAbs_) : 0;
                                float lastVal = (relLast < filt_.size() ? std::max(0.0f, filt_[relLast]) : y1);
                                double lastCmp = lastVal;
                                if (hpThreshold_) {
                                    double vmin = y1, vmax = y1; for (float vv : rollWinRect_) { if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv; }
                                    double den2 = std::max(1e-6, vmax - vmin);
                                    lastCmp = (lastVal - vmin) / den2 * 1024.0;
                                }
                                if (y1Cmp > lastCmp) peaksAbs_.back() = absIdx;
                            }
                        }
                        // Update lastPeaks_/lastRR_ immediately
                        lastPeaks_.clear(); lastRR_.clear();
                        const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
                        for (size_t j = 0; j < peaksAbs_.size(); ++j) {
                            size_t rel = peaksAbs_[j] - firstAbs_;
                            lastPeaks_.push_back(static_cast<int>(rel));
                            if (j > 0) {
                                double dts = static_cast<double>(peaksAbs_[j] - peaksAbs_[j - 1]) / effFs;
                                lastRR_.push_back(dts * 1000.0);
                            }
                        }
                        // Diagnostics already tracked above via appliedRef/min_rr_ms
                    }
                }
            }
        }
        ++totalAbs_;
    }
    // Rebuild display buffer decimation
    const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    int stride = std::max(1, (int)std::lround(effFs / std::max(10.0, displayHz_)));
    displayBuf_.clear(); displayBuf_.reserve(filt_.size() / stride + 1);
    for (size_t idx = 0; idx < filt_.size(); idx += (size_t)stride) displayBuf_.push_back(filt_[idx]);
    trimToWindow();
}

bool RealtimeAnalyzer::poll(HeartMetrics& out) {
    // Only emit once per updateSec_ of newly received samples
    if ((lastTs_ - lastEmitTime_) < updateSec_) return false;
    lastEmitTime_ = lastTs_;

    // Batch fallback: analyze the current sliding window via analyzeSignal()
    if (signal_.empty()) return false;
    std::vector<double> win; win.reserve(signal_.size());
    // Use full‑rate filtered signal for analysis (not decimated display buffer)
    for (float v : filt_) win.push_back(static_cast<double>(v));
    Options o = opt_;
    // Keep user-configured bandpass; callers may set lowHz=highHz=0 to skip
    const double fsEff = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    out = analyzeSignal(win, fsEff, o);

    // If HP-style thresholding requested, calibrate ma_perc on the current window
    if (opt_.useHPThreshold) {
        // Rolling mean over ~0.75s as in HeartPy
        // Positive-baseline scale window to [0..1024] for HP-style threshold
        double wmin = *std::min_element(win.begin(), win.end());
        double wmax = *std::max_element(win.begin(), win.end());
        double wden = std::max(1e-6, wmax - wmin);
        std::vector<double> swin; swin.reserve(win.size());
        for (double v : win) swin.push_back((v - wmin) / wden * 1024.0);
        auto rmean = rollingMeanHP_local(swin, fsEff, 0.75);
        double rmean_avg = meanVec(rmean);
        // Retune only every maUpdateSec_ seconds (hysteresis)
        if ((lastTs_ - lastMaUpdateTime_) >= maUpdateSec_) {
            // candidate ma_perc grid (expanded)
            std::vector<double> grid = {10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 50.0, 60.0};
            double best_ma = maPerc_;
            double best_score = 1e300; // lower is better
            std::vector<int> best_peaks_rel;
            for (double ma : grid) {
                auto cand = detectPeaksHP_local(swin, rmean, ma, fsEff);
                cand = consolidateByRefractory(cand, win, refractorySamples_);
                if (cand.size() < 2) continue;
                std::vector<double> rr_ms; rr_ms.reserve(cand.size() - 1);
                for (size_t i = 1; i < cand.size(); ++i) rr_ms.push_back((cand[i] - cand[i - 1]) * 1000.0 / fsEff);
                double mean_rr = meanVec(rr_ms);
                if (mean_rr <= 1e-6) continue;
                double bpm = 60000.0 / mean_rr;
                // score: RR std, penalize if outside BPM limits
                double var = 0.0; for (double r : rr_ms) { double d = r - mean_rr; var += d * d; } var /= rr_ms.size();
                double sd = std::sqrt(std::max(0.0, var));
                double penalty = 0.0;
                if (bpm < opt_.bpmMin || bpm > opt_.bpmMax) penalty = 1e3; // heavy penalty
                // Bias against implausibly high BPM relative to prior
                double bpm_prior = bpmEmaValid_ ? bpmEma_ : (0.5 * (opt_.bpmMin + opt_.bpmMax));
                bpm_prior = std::max(opt_.bpmMin, std::min(opt_.bpmMax, bpm_prior));
                double highThresh = std::max(110.0, bpm_prior + 15.0);
                double excess = std::max(0.0, (bpm - highThresh)) / 40.0;
                double k = 0.4;
                double score = sd * (1.0 + k * excess) + penalty;
                // Optional guard: if bpm is high and lift is very low, penalize low ma
                if ((bpm > highThresh) && (ma < 25.0)) {
                    score += sd; // add one SD as penalty
                }
                if (score < best_score) { best_score = score; best_ma = ma; best_peaks_rel = std::move(cand); }
            }
            if (!best_peaks_rel.empty()) {
                // Hysteresis: switch only if improvement >=10%
                double old = maPercScore_;
                if (old <= 0.0) old = 1e300;
                double rel_impr = (old > 0.0 && old < 1e299) ? ((old - best_score) / old) : 1.0;
                bool dwell_ok = (lastTs_ - lastMaChangeTime_) >= 6.0;
                if ((rel_impr >= 0.15 || maPercScore_ >= 1e299) && dwell_ok) {
                    // Upward bias: if persistent high BPM and chosen ma < 25, nudge +10
                    bool bpmHighPersist = (bpmEmaValid_ && bpmEma_ > 120.0 && (lastTs_ - firstTsApprox_) >= 10.0);
                    maPerc_ = best_ma;
                    if (bpmHighPersist && maPerc_ < 25.0) maPerc_ = std::min(60.0, maPerc_ + 10.0);
                    maPercScore_ = best_score;
                    // Replace window peaks with calibrated HP result
                    peaksAbs_.clear(); peaksAbs_.reserve(best_peaks_rel.size());
                    for (int rel : best_peaks_rel) peaksAbs_.push_back(firstAbs_ + (size_t)rel);
                    // Recompute streaming lastPeaks_/lastRR_
                    lastPeaks_.clear(); lastRR_.clear();
                    for (size_t j = 0; j < peaksAbs_.size(); ++j) {
                        size_t rel = peaksAbs_[j] - firstAbs_;
                        lastPeaks_.push_back((int)rel);
                        if (j > 0) {
                            double dts = (double)(peaksAbs_[j] - peaksAbs_[j - 1]) / fsEff;
                            lastRR_.push_back(dts * 1000.0);
                        }
                    }
                    lastMaChangeTime_ = lastTs_;
                }
            }
            lastMaUpdateTime_ = lastTs_;
        }
        // Update base lift for current maPerc_
        baseLift_ = (rmean_avg / 100.0) * maPerc_;
        hpThreshold_ = true;
        // Apply ma_perc floors if persistent high-HR & high-CV (checked in S4; may be last known state)
        if (cvHighActive_ && (lastTs_ - cvHighStartTs_) >= 6.0 && bpmEma_ > 120.0) {
            maPerc_ = std::max(maPerc_, 15.0);
        }
        if (cvHighActive_ && (lastTs_ - cvHighStartTs_) >= 10.0 && bpmEma_ > 130.0) {
            maPerc_ = std::max(maPerc_, 20.0);
        }
        // Export active ma_perc for diagnostics
        out.quality.maPercActive = maPerc_;
    }

    // Cache a few items for convenience (updated again after SNR)
    lastQuality_ = out.quality;
    // Prefer streaming peaks/RR; if empty, fall back to batch results
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

        // Update BPM from streaming RR (accepted intervals only)
        double rr_sum = 0.0; int rr_cnt = 0;
        for (size_t i = 0; i < rr_ms.size(); ++i) if (rr_mask[i] == 0) { rr_sum += rr_ms[i]; ++rr_cnt; }
        if (rr_cnt > 0) {
            double mean_rr = rr_sum / rr_cnt;
            if (mean_rr > 1e-6) out.bpm = 60000.0 / mean_rr;
        }
        // Update BPM EMA prior for ma_perc bias
        double now_b = lastTs_;
        if (out.bpm > 0.0) {
            double dtb = (lastBpmUpdateTime_ > 0.0) ? (now_b - lastBpmUpdateTime_) : updateSec_;
            double alphab = 1.0 - std::exp(-dtb / std::max(1e-3, bpmTauSec_));
            if (!bpmEmaValid_) { bpmEma_ = out.bpm; bpmEmaValid_ = true; }
            else bpmEma_ = (1.0 - alphab) * bpmEma_ + alphab * out.bpm;
            lastBpmUpdateTime_ = now_b;
            // Track persistent high BPM epoch (for RR-based doubling hint)
            if (bpmEmaValid_ && bpmEma_ > 120.0) {
                if (!bpmHighActive_) { bpmHighActive_ = true; bpmHighStartTs_ = now_b; }
            } else {
                bpmHighActive_ = false; bpmHighStartTs_ = 0.0;
            }
        }

        // Phase S5: build 10-beat sliding binary windows (BinarySegments)
        out.binarySegments.clear();
        int windowBeats = 10; // default
        if (opt_.segmentRejectWindowBeats > 0) windowBeats = opt_.segmentRejectWindowBeats;
        int maxRejects = std::max(0, opt_.segmentRejectMaxRejects);
        const int beats = static_cast<int>(rr_ms.size() + 1);
        // rr_mask is per interval; window intervals = windowBeats - 1
        const int winIntervals = std::max(0, windowBeats - 1);
        if (beats >= windowBeats && winIntervals > 0) {
            // step beats computed from overlap ratio
            double ov = std::min(1.0, std::max(0.0, opt_.segmentRejectOverlap));
            int stepBeats = std::max(1, (int)std::lround(windowBeats * (1.0 - ov)));
            int idx = 0;
            for (int b0 = 0; b0 + windowBeats <= beats; b0 += stepBeats) {
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

        // Final consolidation: keep strongest within refractory across window
        if (!lastPeaks_.empty()) {
            auto consolidated = consolidateByRefractory(lastPeaks_, win, refractorySamples_);
            if (consolidated.size() != lastPeaks_.size()) {
                lastPeaks_ = std::move(consolidated);
                // rebuild RR from consolidated peaks
                lastRR_.clear();
                for (size_t j = 1; j < lastPeaks_.size(); ++j) {
                    double dts = (lastPeaks_[j] - lastPeaks_[j - 1]) / fsEff;
                    lastRR_.push_back(dts * 1000.0);
                }
            }
        }

        // Periodic suppression: keep only one peak per expected period window anchored to last kept peak
        if ((softDoublingActive_ || doublingActive_ || doublingHintActive_) && lastPeaks_.size() >= 2 && (lastTs_ > chokeRelaxUntil_)) {
            const double fsEffLoc = fsEff;
            // Prefer RR-derived long period; fallback to f0
            double longMs = 0.0;
            if (out.quality.rrLongMs > 0.0) longMs = out.quality.rrLongMs;
            if (longMs <= 0.0 && !lastRR_.empty()) {
                std::vector<double> tmpRR = lastRR_;
                std::nth_element(tmpRR.begin(), tmpRR.begin() + tmpRR.size()/2, tmpRR.end());
                double med = tmpRR[tmpRR.size()/2];
                longMs = 2.0 * med;
            }
            if (longMs <= 0.0 && lastF0Hz_ > 1e-9) longMs = 1000.0 / lastF0Hz_;
            double T = (longMs > 0.0 ? (longMs / 1000.0) : 0.0);
            if (T > 0.0) {
                // If hint is driven by RR-fallback only, skip periodic suppression for this poll
                if (rrFallbackDrivingHint_) {
                    // no suppression; rely on min-RR gate + refractory
                } else {
                double tol = opt_.periodicSuppressionTol * T; // conservative (active only)
                const size_t n0 = lastPeaks_.size();
                size_t removed = 0, merges = 0;
                std::vector<char> keepP(lastPeaks_.size(), 1);
                // Start from the first peak as last kept
                size_t kidx = 0;
                double tlast = firstTsApprox_ + (lastPeaks_[kidx] / fsEffLoc);
                size_t j = kidx + 1;
                while (j < lastPeaks_.size()) {
                    double t = firstTsApprox_ + (lastPeaks_[j] / fsEffLoc);
                    if (t < (tlast + 0.5 * T)) { ++j; continue; }
                    if (t > (tlast + 1.5 * T)) { tlast = t; kidx = j; ++j; continue; }
                    // Collect all peaks within [tlast+0.5T, tlast+1.5T]
                    size_t wstart = j;
                    while (j < lastPeaks_.size()) {
                        double tt = firstTsApprox_ + (lastPeaks_[j] / fsEffLoc);
                        if (tt <= (tlast + 1.5 * T)) ++j; else break;
                    }
                    // Window indices [wstart, j)
                    if (j > wstart) {
                        size_t best = wstart;
                        double bestA = (lastPeaks_[best] >= 0 && lastPeaks_[best] < (int)win.size()) ? win[lastPeaks_[best]] : 0.0;
                        for (size_t s = wstart + 1; s < j; ++s) {
                            double a = (lastPeaks_[s] >= 0 && lastPeaks_[s] < (int)win.size()) ? win[lastPeaks_[s]] : 0.0;
                            if (a > bestA) { best = s; bestA = a; }
                        }
                        // Mark all others in window for removal
                        for (size_t s = wstart; s < j; ++s) {
                            if (s != best && keepP[s]) { keepP[s] = 0; ++removed; ++merges; if (merges >= 10) break; }
                        }
                        kidx = best; tlast = firstTsApprox_ + (lastPeaks_[kidx] / fsEffLoc);
                        // Early stop for safety
                        if (merges >= 10 || removed > (size_t)(0.4 * n0)) break;
                    }
                }
                // RR-fallback-only cap: do not remove more than 25% in a single poll
                size_t maxRm = rrFallbackActive_ ? (size_t)std::floor(0.25 * n0) : (size_t)(-1);
                if (rrFallbackActive_ && removed > maxRm) {
                    // revert suppression for this poll
                } else if (removed > 0) {
                    std::vector<int> newPeaks;
                    for (size_t q = 0; q < lastPeaks_.size(); ++q) if (keepP[q]) newPeaks.push_back(lastPeaks_[q]);
                    lastPeaks_.swap(newPeaks);
                    lastRR_.clear();
                    for (size_t u = 1; u < lastPeaks_.size(); ++u) {
                        double dts = (lastPeaks_[u] - lastPeaks_[u - 1]) / fsEff;
                        lastRR_.push_back(dts * 1000.0);
                    }
                }
                }
            }
        }

        // Doubling repair on RR sequence: coalesce pairs of short intervals
        // Snapshot for safety brake
        std::vector<int> peaks_before = lastPeaks_;
        std::vector<double> rr_before = lastRR_;
        if (lastRR_.size() >= 3 && lastPeaks_.size() == lastRR_.size() + 1) {
            std::vector<double> rr_copy = lastRR_;
            std::vector<double> rr_sorted = rr_copy; std::nth_element(rr_sorted.begin(), rr_sorted.begin() + rr_sorted.size()/2, rr_sorted.end());
            double m = rr_sorted[rr_sorted.size()/2];
            std::vector<char> keep(lastPeaks_.size(), 1);
            for (size_t i = 0; i + 1 < lastRR_.size(); ++i) {
                double r1 = lastRR_[i];
                double r2 = lastRR_[i + 1];
                double sum = r1 + r2;
                bool merge = false;
                // Default heuristic (no harmonic context): detect very short followed by near-median pair
                if (r1 < 0.65 * m && sum >= 0.8 * m && sum <= 1.2 * m) merge = true;
                // Harmonic-context heuristic: when soft/hard doubling active, target ~2x median pair sums
                if (!merge && (softDoublingActive_ || doublingActive_)) {
                    double m_long = 2.0 * m;
                    if ((std::min(r1, r2) < 0.9 * m) && (sum >= 0.8 * m_long && sum <= 1.2 * m_long)) merge = true;
                }
                // Generic doubling pattern: two short intervals whose sum ~ 2x median
                if (!merge) {
                    double m_long = 2.0 * m;
                    if ((std::min(r1, r2) < 0.85 * m) && (sum >= opt_.rrMergeBandLow * m_long && sum <= opt_.rrMergeBandHigh * m_long)) merge = true;
                }
                // Equal short pair merge when soft/hard active: both ~median and sum ~2×median
                if (!merge && (softDoublingActive_ || doublingActive_)) {
                    double m_long = 2.0 * m;
                    bool bothShortish = (r1 >= opt_.rrMergeEqualBandLow * m && r1 <= opt_.rrMergeEqualBandHigh * m && r2 >= opt_.rrMergeEqualBandLow * m && r2 <= opt_.rrMergeEqualBandHigh * m);
                    bool sumLongish = (sum >= opt_.rrMergeEqualBandLow * m_long && sum <= opt_.rrMergeEqualBandHigh * m_long);
                    if (bothShortish && sumLongish) merge = true;
                }
                if (merge) {
                        // remove inner peak at index i+1 (compare amplitudes around peaks i+1 vs neighbors)
                        int pL = lastPeaks_[i];
                        int pM = lastPeaks_[i + 1];
                        int pR = lastPeaks_[i + 2];
                        double aL = (pL >= 0 && pL < (int)win.size()) ? win[pL] : 0.0;
                        double aM = (pM >= 0 && pM < (int)win.size()) ? win[pM] : 0.0;
                        double aR = (pR >= 0 && pR < (int)win.size()) ? win[pR] : 0.0;
                        // remove middle if it is not stronger than both neighbors
                        if (aM <= std::max(aL, aR)) {
                            keep[i + 1] = 0;
                            ++i; // skip next as it merges with this short
                        }
                }
            }
            // rebuild peaks if any removal
            bool any = false; for (char c : keep) if (!c) { any = true; break; }
            if (any) {
                std::vector<int> newPeaks;
                for (size_t k = 0; k < keep.size(); ++k) if (keep[k]) newPeaks.push_back(lastPeaks_[k]);
                lastPeaks_.swap(newPeaks);
                lastRR_.clear();
                for (size_t j = 1; j < lastPeaks_.size(); ++j) {
                    double dts = (lastPeaks_[j] - lastPeaks_[j - 1]) / fsEff;
                    lastRR_.push_back(dts * 1000.0);
                }
            }
            // Aggressive pass when soft/hard/hint doubling is active; iterate until no changes
            if ((softDoublingActive_ || doublingActive_ || doublingHintActive_) && !rrFallbackDrivingHint_) {
                bool changed = true; size_t removedTotal = 0; const size_t nInit = lastPeaks_.size();
                int iteration = 0; const int maxIterations = 10;
                while (changed && iteration < maxIterations) {
                    changed = false;
                    ++iteration;
                    if (lastRR_.size() >= 3) {
                        std::vector<double> rrs = lastRR_;
                        std::vector<double> tmp2 = rrs; std::nth_element(tmp2.begin(), tmp2.begin() + tmp2.size()/2, tmp2.end());
                        double m2 = tmp2[tmp2.size()/2];
                        double two = 2.0 * m2;
                        std::vector<char> keep2(lastPeaks_.size(), 1);
                        for (size_t i = 0; i + 1 < rrs.size(); ++i) {
                            double r1 = rrs[i];
                            double r2 = rrs[i + 1];
                            double sum = r1 + r2;
                            bool condShortPairA = (r1 < 0.85 * m2) && (sum >= opt_.rrMergeBandLow * two && sum <= opt_.rrMergeBandHigh * two);
                            bool condShortPairB = (r1 < 0.75 * m2) && (sum >= 0.8 * two && sum <= 1.2 * two);
                            bool bothNearMed = (r1 >= opt_.rrMergeBandLow * m2 && r1 <= opt_.rrMergeBandHigh * m2 && r2 >= opt_.rrMergeBandLow * m2 && r2 <= opt_.rrMergeBandHigh * m2);
                            bool sumNearTwo = (sum >= 0.80 * two && sum <= 1.20 * two);
                            bool mergeEq = bothNearMed && sumNearTwo;
                            if (condShortPairA || condShortPairB || mergeEq) {
                                // remove inner peak at index i+1 (compare amplitudes)
                                int pL = lastPeaks_[i];
                                int pM = lastPeaks_[i + 1];
                                int pR = lastPeaks_[i + 2];
                                double aL = (pL >= 0 && pL < (int)win.size()) ? win[pL] : 0.0;
                                double aM = (pM >= 0 && pM < (int)win.size()) ? win[pM] : 0.0;
                                double aR = (pR >= 0 && pR < (int)win.size()) ? win[pR] : 0.0;
                                if (aM <= std::max(aL, aR)) { keep2[i + 1] = 0; changed = true; ++i; ++removedTotal; }
                            }
                        }
                        if (changed) {
                            std::vector<int> newPeaks2;
                            for (size_t k = 0; k < keep2.size(); ++k) if (keep2[k]) newPeaks2.push_back(lastPeaks_[k]);
                            lastPeaks_.swap(newPeaks2);
                            lastRR_.clear();
                            for (size_t j = 1; j < lastPeaks_.size(); ++j) {
                                double dts = (lastPeaks_[j] - lastPeaks_[j - 1]) / fsEff;
                                lastRR_.push_back(dts * 1000.0);
                            }
                            if (removedTotal > (size_t)(0.4 * nInit)) break;
                        }
                    }
                }
            } else if (rrFallbackDrivingHint_) {
                // RR-fallback path: enable a very-limited merge with tight bands and hard caps; suppression stays OFF
                if (lastRR_.size() >= 3) {
                    std::vector<double> tmp2 = lastRR_;
                    std::nth_element(tmp2.begin(), tmp2.begin() + tmp2.size()/2, tmp2.end());
                    double m2 = tmp2[tmp2.size()/2];
                    double two = 2.0 * m2;
                    const size_t nInit = lastPeaks_.size();
                    size_t cap = std::min<size_t>(10, (size_t)std::floor(0.10 * nInit));
                    size_t removed = 0;
                    std::vector<char> keepF(lastPeaks_.size(), 1);
                    for (size_t i = 0; i + 1 < lastRR_.size(); ++i) {
                        if (removed >= cap) break;
                        double r1 = lastRR_[i];
                        double r2 = lastRR_[i + 1];
                        double sum = r1 + r2;
                        bool nearMedBoth = (r1 >= opt_.rrMergeBandLow * m2 && r1 <= opt_.rrMergeBandHigh * m2 && r2 >= opt_.rrMergeBandLow * m2 && r2 <= opt_.rrMergeBandHigh * m2);
                        bool sumNearLong = (sum >= 0.93 * two && sum <= 1.07 * two);
                        if (nearMedBoth && sumNearLong) {
                            int pL = lastPeaks_[i];
                            int pM = lastPeaks_[i + 1];
                            int pR = lastPeaks_[i + 2];
                            double aL = (pL >= 0 && pL < (int)win.size()) ? win[pL] : 0.0;
                            double aM = (pM >= 0 && pM < (int)win.size()) ? win[pM] : 0.0;
                            double aR = (pR >= 0 && pR < (int)win.size()) ? win[pR] : 0.0;
                            if (aM <= std::max(aL, aR)) { keepF[i + 1] = 0; ++removed; ++i; }
                        }
                    }
                    if (removed > 0) {
                        std::vector<int> newPeaksF;
                        for (size_t k = 0; k < keepF.size(); ++k) if (keepF[k]) newPeaksF.push_back(lastPeaks_[k]);
                        lastPeaks_.swap(newPeaksF);
                        lastRR_.clear();
                        for (size_t j = 1; j < lastPeaks_.size(); ++j) {
                            double dts = (lastPeaks_[j] - lastPeaks_[j - 1]) / fsEff;
                            lastRR_.push_back(dts * 1000.0);
                        }
                    }
                }
            }
        }
        // Safety brake: prevent excessive downshift
        double bpmEstNow = 0.0;
        if (!lastRR_.empty()) { std::vector<double> tmp = lastRR_; std::nth_element(tmp.begin(), tmp.begin()+tmp.size()/2, tmp.end()); double med = tmp[tmp.size()/2]; if (med>1e-6) bpmEstNow = 60000.0/med; }
        if (rrFallbackActive_ && lastPollBpmEst_ > 100.0 && bpmEstNow > 0.0 && bpmEstNow < 50.0) {
            // revert this poll's changes
            lastPeaks_ = peaks_before;
            lastRR_ = rr_before;
        }
        // update last poll bpm estimate
        if (!lastRR_.empty()) { std::vector<double> tmp2 = lastRR_; std::nth_element(tmp2.begin(), tmp2.begin()+tmp2.size()/2, tmp2.end()); double med2 = tmp2[tmp2.size()/2]; if (med2>1e-6) lastPollBpmEst_ = 60000.0/med2; }

        // Produce a coarse binaryPeakMask aligned to current peakList (streaming)
        out.binaryPeakMask.clear();
        if (!lastPeaks_.empty()) {
            out.peakList = lastPeaks_;
            out.rrList = lastRR_;
            out.binaryPeakMask.assign(lastPeaks_.size(), 1);
            // Mark beats involved in rejected intervals as 0
            for (size_t k = 0; k + 1 < lastPeaks_.size() && k < rr_mask.size(); ++k) {
                if (rr_mask[k]) { out.binaryPeakMask[k] = 0; out.binaryPeakMask[k + 1] = 0; }
            }
        }
    }
    // Phase S6: compute SNR/Confidence periodically (HR-based); do not override breathing here
    updateSNR(out);
    // Persist smoothed SNR/conf across polls (avoid zeroing between PSD updates)
    if (snrEmaValid_) {
        out.quality.snrDb = snrEmaDb_;
        // Active window for slightly more responsive confidence mapping
        double lastActiveTs2 = 0.0;
        if (softLastTrueTs_ > 0.0) lastActiveTs2 = std::max(lastActiveTs2, softLastTrueTs_);
        if (doublingLastTrueTs_ > 0.0) lastActiveTs2 = std::max(lastActiveTs2, doublingLastTrueTs_);
        if (hintLastTrueTs_ > 0.0) lastActiveTs2 = std::max(lastActiveTs2, hintLastTrueTs_);
        bool persistMap2 = (lastActiveTs2 > 0.0) && ((lastTs_ - lastActiveTs2) <= 5.0);
        bool activeConf = doublingHintActive_ || softDoublingActive_ || doublingActive_ || persistMap2;
        // Recompute confidence from smoothed SNR
        // Slightly friendlier center when active to reflect harmonic-context SNR mapping
        double x0 = activeConf ? 5.2 : 6.0;
        double ksig = activeConf ? (1.0 / 1.2) : 0.8; // ~0.833 when active
        double conf_snr = 1.0 / (1.0 + std::exp(-ksig * (snrEmaDb_ - x0)));
        double conf = conf_snr * (1.0 - out.quality.rejectionRate);
        double cv = 0.0;
        if (!out.rrList.empty()) {
            double mean_rr = 0.0; for (double r : out.rrList) mean_rr += r; mean_rr /= (double)out.rrList.size();
            double var_rr = 0.0; for (double r : out.rrList) { double d = r - mean_rr; var_rr += d * d; }
            var_rr /= (double)out.rrList.size(); double sd_rr = std::sqrt(std::max(0.0, var_rr));
            cv = (mean_rr > 1e-9) ? (sd_rr / mean_rr) : 0.0;
            conf *= std::max(0.0, 1.0 - (activeConf ? 0.5 : 1.0) * cv);
        }
        // Optional conservative boost when very clean and stable under active window
        if (activeConf) {
            double activeSecs = 0.0;
            if (softDoublingActive_) activeSecs = std::max(activeSecs, lastTs_ - softStartTs_);
            if (doublingHintActive_ && hintStartTs_ > 0.0) activeSecs = std::max(activeSecs, lastTs_ - hintStartTs_);
            if (out.quality.rejectionRate < 0.03 && cv < 0.12 && activeSecs >= 8.0) conf = std::min(1.0, conf * 1.1);
        }
        bool warmed2 = ((lastTs_ - firstTsApprox_) >= 15.0) || (out.rrList.size() >= 15);
        if (!warmed2) conf = 0.0;
        out.quality.confidence = std::max(0.0, std::min(1.0, conf));
    }
    out.quality.refractoryMsActive = lastRefMsActive_;
    out.quality.minRRBoundMs = lastMinRRBoundMs_;
    // refresh cached quality
    lastQuality_ = out.quality;
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

    // Use full-rate filtered window for PSD and derive SNR around HR
    const double effFs = (effectiveFs_ > 1e-6 ? effectiveFs_ : fs_);
    if (effFs <= 0.0 || filt_.size() < 32) return;

    // Estimate HR frequency f0 (Hz) from streaming RR if available; fallback to out.bpm; reuse last if missing
    double f0 = 0.0;
    if (!out.rrList.empty()) {
        double mrr = 0.0; for (double r : out.rrList) mrr += r; mrr /= (double)out.rrList.size();
        if (mrr > 1e-3) f0 = 1000.0 / mrr; // ms -> Hz
    }
    if (f0 <= 0.0 && out.bpm > 0.0) f0 = out.bpm / 60.0;
    if (f0 <= 0.0 && lastF0Hz_ > 0.0) f0 = lastF0Hz_;
    // If no HR estimate, skip SNR update
    if (f0 <= 0.0) return;
    lastF0Hz_ = f0;

    // Build analysis vector (copy of filt_)
    std::vector<double> y; y.reserve(filt_.size());
    for (float v : filt_) y.push_back((double)v);

    // Welch PSD on the full-rate filtered signal
    int nfft = opt_.nfft > 0 ? opt_.nfft : 256;
    auto ps = welchPowerSpectrum(y, effFs, nfft, opt_.overlap);
    const auto &frq = ps.first; const auto &P = ps.second;
    if (frq.size() < 4 || frq.size() != P.size()) return;

    auto inBand = [](double f, double c, double bw){ return std::fabs(f - c) <= bw; };
    double nyq = 0.5 * effFs;
    double df = (frq.size() > 1 ? frq[1] - frq[0] : 0.0);
    // Adaptive signal band width based on resolution
    // Active flags for widened SNR band and faster EMA
    double lastActiveTs = 0.0;
    if (softLastTrueTs_ > 0.0) lastActiveTs = std::max(lastActiveTs, softLastTrueTs_);
    if (doublingLastTrueTs_ > 0.0) lastActiveTs = std::max(lastActiveTs, doublingLastTrueTs_);
    if (hintLastTrueTs_ > 0.0) lastActiveTs = std::max(lastActiveTs, hintLastTrueTs_);
    bool persistMapLoc = (lastActiveTs > 0.0) && ((lastTs_ - lastActiveTs) <= 5.0);
    bool activeSnr = doublingHintActive_ || softDoublingActive_ || doublingActive_ || persistMapLoc;
    // SNR signal-band half-width (Hz): Options control passive/active widths
    double baseBw = activeSnr ? opt_.snrBandActive : opt_.snrBandPassive;
    double band = std::max(2.0 * df, baseBw);
    double guard = 0.03; // extra exclusion around signal bands
    double peakPow = 0.0; // integrated signal power
    double peakPow2 = 0.0;
    std::vector<double> noiseVals;
    noiseVals.reserve(frq.size());
    for (size_t i = 0; i < frq.size(); ++i) {
        double f = frq[i];
        double pv = std::abs(P[i]);
        bool sig1 = inBand(f, f0, band);
        bool sig2 = (2.0 * f0 < nyq) && inBand(f, 2.0 * f0, band);
        if (sig1) peakPow += pv;
        if (sig2) peakPow2 += pv;
        bool nearSig = inBand(f, f0, band + guard) || ((2.0 * f0 < nyq) && inBand(f, 2.0 * f0, band + guard));
        if (!nearSig && f >= 0.4 && f <= 5.0) noiseVals.push_back(pv);
    }
    double signalPow = peakPow + peakPow2;
    double noiseBaseline = 0.0;
    if (!noiseVals.empty()) {
        // median of noise band
        std::nth_element(noiseVals.begin(), noiseVals.begin() + noiseVals.size()/2, noiseVals.end());
        noiseBaseline = noiseVals[noiseVals.size()/2];
    }
    double snrDbInst = (signalPow > 0.0 && noiseBaseline > 0.0) ? (10.0 * std::log10(signalPow / (noiseBaseline * (band * 2.0 / std::max(1e-6, df))))) : 0.0;
    if (!std::isfinite(snrDbInst)) snrDbInst = 0.0;
    // EMA smoothing over time (tau = 8s when active)
    double now = lastTs_;
    double dt = (lastSnrUpdateTime_ > 0.0) ? (now - lastSnrUpdateTime_) : psdUpdateSec_;
    double tau = activeSnr ? opt_.snrActiveTauSec : snrTauSec_;
    double alpha = 1.0 - std::exp(-dt / std::max(1e-3, tau));
    if (!snrEmaValid_) { snrEmaDb_ = snrDbInst; snrEmaValid_ = true; }
    else {
        snrEmaDb_ = (1.0 - alpha) * snrEmaDb_ + alpha * snrDbInst;
    }
    // Blend toward instant value when band mode or width changes to avoid step bias
    bool bandWidthChanged = (std::fabs(baseBw - lastSnrBaseBw_) > 1e-9) || (activeSnr != lastSnrActiveMode_);
    if (bandWidthChanged) {
        double bf = std::clamp(opt_.snrBandBlendFactor, 0.0, 1.0);
        snrEmaDb_ = (1.0 - bf) * snrEmaDb_ + bf * snrDbInst;
    }
    lastSnrBaseBw_ = baseBw; lastSnrActiveMode_ = activeSnr;
    lastSnrUpdateTime_ = now;
    if (!std::isfinite(snrEmaDb_)) snrEmaDb_ = 0.0;
    out.quality.snrDb = snrEmaDb_;
    out.quality.f0Hz = lastF0Hz_;

    // Harmonic suppression heuristic (conservative)
    // Compute power near fundamental and half-fundamental
    double f0Half = 0.5 * lastF0Hz_;
    double pFund = 0.0, pHalf = 0.0;
    if (lastF0Hz_ > 0.0) {
        for (size_t i = 0; i < frq.size(); ++i) {
            double f = frq[i]; double pv = std::abs(P[i]);
            if (inBand(f, lastF0Hz_, band)) pFund += pv;
            if (f0Half > 0.0 && inBand(f, f0Half, band)) pHalf += pv;
        }
    }
    // RR bimodality and pair consistency
    double shortFrac = 0.0, longRR = 0.0, rrCV = 0.0, pairFrac = 0.0;
    double shortMean = 0.0, longMean = 0.0;
    if (!out.rrList.empty()) {
        std::vector<double> rr = out.rrList;
        // median
        std::vector<double> tmp = rr; std::nth_element(tmp.begin(), tmp.begin() + tmp.size()/2, tmp.end());
        double med = tmp[tmp.size()/2];
        double thr = 0.8 * med;
        double sumLong = 0.0, sumShort = 0.0; int cntLong = 0, cntShort = 0;
        for (double r : rr) { if (r >= thr) { sumLong += r; ++cntLong; } else { sumShort += r; ++cntShort; } }
        if (cntLong > 0) longRR = sumLong / cntLong; else longRR = med;
        longMean = (cntLong > 0 ? (sumLong / cntLong) : med);
        shortMean = (cntShort > 0 ? (sumShort / cntShort) : 0.0);
        shortFrac = (rr.size() > 0 ? (cntShort / (double)rr.size()) : 0.0);
        // RR CV
        double mean_rr = meanVec(rr);
        double var_rr = 0.0; for (double r : rr) { double d = r - mean_rr; var_rr += d * d; }
        var_rr /= (double)rr.size(); rrCV = (mean_rr > 1e-9) ? std::sqrt(std::max(0.0, var_rr)) / mean_rr : 0.0;
        // Pair consistency
        int cntPairs = 0, goodPairs = 0;
        for (size_t i = 0; i + 1 < rr.size(); ++i) {
            double s = rr[i] + rr[i + 1];
            if (longRR > 0.0) {
                ++cntPairs;
                if (s >= 0.85 * longRR && s <= 1.15 * longRR) ++goodPairs;
            }
        }
        pairFrac = (cntPairs > 0 ? (goodPairs / (double)cntPairs) : 0.0);
    }
    // Tiered harmonic suppression
    double ratioHalfFund = (pFund > 0.0 ? (pHalf / pFund) : 0.0);
    // Compute warm-up first (used for adaptive drift tolerance)
    int acceptedRR = std::max(0, (int)acceptedPeaksTotal_ - 1);
    bool warmupPassed = ((lastTs_ - firstTsApprox_) >= 15.0) && (acceptedRR >= 10);
    // Track half-f0 stability over recent PSD updates (longer history, adaptive drift)
    if (f0Half > 0.0) { halfF0Hist_.push_back(f0Half); if (halfF0Hist_.size() > 5) halfF0Hist_.pop_front(); }
    else halfF0Hist_.clear();
    double driftTol = warmupPassed ? 0.06 : 0.10;
    bool halfStable = false; if (halfF0Hist_.size() >= 2) { double fmin = *std::min_element(halfF0Hist_.begin(), halfF0Hist_.end()); double fmax = *std::max_element(halfF0Hist_.begin(), halfF0Hist_.end()); halfStable = ((fmax - fmin) <= driftTol); }
    // Warm-up for soft flag: time ≥15s AND ≥10 accepted RR (decouple from bpmEma)
    bool softGuards = (out.quality.rejectionRate <= 0.05) && (rrCV <= 0.30) && warmupPassed;
    // Anchor soft logic to start only after warm-up passes; reset on transition
    if (warmupPassed && !warmupWasPassed_) { softConsecPass_ = 0; halfF0Hist_.clear(); }
    warmupWasPassed_ = warmupPassed;
    // Immediate soft activation post warm-up on PSD dominance (no streak requirement)
    bool softPass = warmupPassed && (ratioHalfFund >= opt_.pHalfOverFundThresholdSoft) && halfStable && softGuards;
    if (softPass) {
        if (!softDoublingActive_) softStartTs_ = lastTs_;
        softDoublingActive_ = true;
        softConsecPass_ = 2; // for logging
        softLastTrueTs_ = lastTs_;
    } else {
        softConsecPass_ = 0;
        // Only keep soft active if hard doubling is governing
        if (!doublingActive_) softDoublingActive_ = false;
    }
    // Stage 2 hard flag check
    bool persistHighBpm = (bpmEmaValid_ && bpmEma_ > 120.0 && out.quality.maPercActive < 25.0);
    bool psdPersists = (ratioHalfFund >= 2.0) && halfStable;
    bool hardStable = (out.quality.rejectionRate <= 0.05) && (rrCV <= 0.20);
    if (softDoublingActive_ && ((lastTs_ - softStartTs_) >= 8.0) && psdPersists && persistHighBpm && hardStable) {
        doublingActive_ = true;
        doublingHoldUntil_ = std::max(doublingHoldUntil_, lastTs_ + 5.0);
        doublingLastTrueTs_ = lastTs_;
        if (longRR > 0.0) doublingLongRRms_ = longRR;
        // Bound hard fallback window to ≤3s and within hold window
        double hardRemain = std::max(0.0, doublingHoldUntil_ - lastTs_);
        hardFallbackUntil_ = lastTs_ + std::min(3.0, hardRemain);
    }
    bool hardGuardsOk = (ratioHalfFund >= 1.5) && halfStable && (out.quality.rejectionRate <= 0.05) && (rrCV <= 0.20);
    if (doublingActive_) { if (hardGuardsOk) doublingLastTrueTs_ = lastTs_; if ((lastTs_ - doublingLastTrueTs_) >= 5.0 && lastTs_ >= doublingHoldUntil_) doublingActive_ = false; }
    // Oversuppression (choke) protection: if active doubling and BPM (from RR median) < 40 for >3s after 20s
    {
        double bpmEst = 0.0;
        if (!out.rrList.empty()) {
            std::vector<double> tmp = out.rrList; std::nth_element(tmp.begin(), tmp.begin() + tmp.size()/2, tmp.end());
            double med = tmp[tmp.size()/2]; if (med > 1e-6) bpmEst = 60000.0 / med;
        }
        bool dblActive = (doublingHintActive_ || softDoublingActive_ || doublingActive_);
        if (dblActive && (lastTs_ >= 20.0) && (bpmEst > 0.0 && bpmEst < 40.0)) {
            if (chokeStartTs_ <= 0.0) chokeStartTs_ = lastTs_;
            if ((lastTs_ - chokeStartTs_) >= 3.0) {
                double recoveryTime = (bpmEst < 35.0) ? 7.0 : 5.0;
                chokeRelaxUntil_ = lastTs_ + recoveryTime; // adaptive relax
            }
        } else {
            chokeStartTs_ = 0.0;
        }
    }
    // Doubling hint (post warm-up): PSD path or RR-centric fallback under conservative guards
    bool psdHintPass = warmupPassed && (ratioHalfFund >= opt_.pHalfOverFundThresholdSoft) && halfStable && (out.quality.rejectionRate <= 0.05) && (rrCV <= 0.30);
    // Optional subdominant PSD fallback (>=1.6 for ~6s, slightly looser drift)
    bool halfStableLoose = false; if (halfF0Hist_.size() >= 2) { double fmin2 = *std::min_element(halfF0Hist_.begin(), halfF0Hist_.end()); double fmax2 = *std::max_element(halfF0Hist_.begin(), halfF0Hist_.end()); halfStableLoose = ((fmax2 - fmin2) <= 0.08); }
    static double psdLoStart = 0.0;
    bool psdLoNow = warmupPassed && (ratioHalfFund >= opt_.pHalfOverFundThresholdLow) && halfStableLoose && (out.quality.rejectionRate <= 0.05) && (rrCV <= 0.20);
    bool psdLoHold = false;
    if (psdLoNow) { if (psdLoStart <= 0.0) psdLoStart = lastTs_; if ((lastTs_ - psdLoStart) >= 6.0) psdLoHold = true; }
    else { psdLoStart = 0.0; }
    // RR-centric fallback: sustained high BPM, clean & stable RR around ~150 BPM (short mode)
    double medRR = 0.0; if (!out.rrList.empty()) { std::vector<double> tmp=out.rrList; std::nth_element(tmp.begin(), tmp.begin()+tmp.size()/2, tmp.end()); medRR = tmp[tmp.size()/2]; }
    bool rrBand = (medRR >= 370.0 && medRR <= 450.0);
    bool highBpmPersist = bpmHighActive_ && ((lastTs_ - std::max(0.0, bpmHighStartTs_)) >= 8.0);
    bool rrClean = (rrCV <= 0.10) && (out.quality.rejectionRate <= 0.03);
    bool rrFallbackNow = warmupPassed && highBpmPersist && rrClean && rrBand;
    if (rrFallbackNow) ++rrFallbackConsec_; else rrFallbackConsec_ = 0;
    bool rrHintPass = (rrFallbackConsec_ >= 3);

    rrFallbackActive_ = rrHintPass; // mark whether RR path triggered this poll
    if (psdHintPass || psdLoHold || rrHintPass) {
        double hold = psdHintPass ? 12.0 : 8.0;
        if (!doublingHintActive_) { hintHoldUntil_ = lastTs_ + hold; hintStartTs_ = lastTs_; }
        doublingHintActive_ = true;
        hintLastTrueTs_ = lastTs_;
        lastHintBadStart_ = 0.0;
        // Track whether hint is driven by RR fallback only (not PSD)
        bool rrOnly = rrHintPass && !(psdHintPass || psdLoHold);
        if (rrOnly) rrFallbackDrivingHint_ = true;
    } else {
        // violation tracking similar to auto-clear: close after 2s of violations (but not before hold)
        if (doublingHintActive_) {
            if (lastHintBadStart_ <= 0.0) lastHintBadStart_ = lastTs_;
            if ((lastTs_ - lastHintBadStart_) >= 2.0 && lastTs_ >= hintHoldUntil_) doublingHintActive_ = false;
        }
    }
    if (!doublingHintActive_) rrFallbackDrivingHint_ = false;

    // Choose f0 used for SNR/conf
    // Auto-clear: if violation persists ≥5s, drop both flags
    bool clearViolate = (ratioHalfFund < 1.5) || (!halfStable) || (rrCV > 0.20) || (out.quality.rejectionRate > 0.05);
    if (clearViolate) {
        if (lastClearBadStart_ <= 0.0) lastClearBadStart_ = lastTs_;
        if ((lastTs_ - lastClearBadStart_) >= 5.0) { softDoublingActive_ = false; doublingActive_ = false; }
    } else {
        lastClearBadStart_ = 0.0;
    }
    bool halfDominant = (ratioHalfFund >= opt_.pHalfOverFundThresholdSoft) && halfStable;
    // Keep mapping to 1/2 f0 for 5s after last active to stabilize SNR/conf
    double lastActiveTs_map = 0.0;
    if (softLastTrueTs_ > 0.0) lastActiveTs_map = std::max(lastActiveTs_map, softLastTrueTs_);
    if (doublingLastTrueTs_ > 0.0) lastActiveTs_map = std::max(lastActiveTs_map, doublingLastTrueTs_);
    if (hintLastTrueTs_ > 0.0) lastActiveTs_map = std::max(lastActiveTs_map, hintLastTrueTs_);
    bool persistMap = (lastActiveTs_map > 0.0) && ((lastTs_ - lastActiveTs_map) <= 5.0);
    bool useHalfForSNR = softDoublingActive_ || doublingActive_ || doublingHintActive_ || halfDominant || persistMap;
    double f0Used = f0;
    if (useHalfForSNR && f0 > 0.0) {
        double signalPowUsed = pHalf + pFund; // half fundamental + original f0
        double snrDbInst2 = (signalPowUsed > 0.0 && noiseBaseline > 0.0) ? (10.0 * std::log10(signalPowUsed / (noiseBaseline * (band * 2.0 / std::max(1e-6, df))))) : 0.0;
        if (!std::isfinite(snrDbInst2)) snrDbInst2 = 0.0;
        if (!snrEmaValid_) { snrEmaDb_ = snrDbInst2; snrEmaValid_ = true; }
        else snrEmaDb_ = (1.0 - alpha) * snrEmaDb_ + alpha * snrDbInst2;
        f0Used = 0.5 * f0;
    }
    lastF0Hz_ = f0Used; out.quality.f0Hz = lastF0Hz_; out.quality.snrDb = snrEmaDb_;
    out.quality.softDoublingFlag = softDoublingActive_ ? 1 : 0;
    out.quality.doublingFlag = doublingActive_ ? 1 : 0;
    out.quality.hardFallbackActive = (doublingActive_ && (lastTs_ <= hardFallbackUntil_)) ? 1 : 0;
    out.quality.doublingHintFlag = doublingHintActive_ ? 1 : 0;
    out.quality.pHalfOverFund = ratioHalfFund;
    out.quality.pairFrac = pairFrac;
    out.quality.rrShortFrac = shortFrac;
    out.quality.rrLongMs = longRR;
    out.quality.softStreak = softConsecPass_;
    out.quality.softSecs = softDoublingActive_ ? (lastTs_ - softStartTs_) : 0.0;
    // Logistic mapping for confidence (mirror active mapping used after updateSNR)
    double lastActiveTs3 = 0.0;
    if (softLastTrueTs_ > 0.0) lastActiveTs3 = std::max(lastActiveTs3, softLastTrueTs_);
    if (doublingLastTrueTs_ > 0.0) lastActiveTs3 = std::max(lastActiveTs3, doublingLastTrueTs_);
    if (hintLastTrueTs_ > 0.0) lastActiveTs3 = std::max(lastActiveTs3, hintLastTrueTs_);
    bool persistMap3 = (lastActiveTs3 > 0.0) && ((lastTs_ - lastActiveTs3) <= 5.0);
    bool activeConf3 = doublingHintActive_ || softDoublingActive_ || doublingActive_ || persistMap3;
    double x0 = activeConf3 ? 5.2 : 6.0; // center (dB)
    double k = activeConf3 ? (1.0/1.2) : 0.8;  // slope
    if (!std::isfinite(snrEmaDb_)) snrEmaDb_ = 0.0;
    double conf_snr = 1.0 / (1.0 + std::exp(-k * (snrEmaDb_ - x0)));
    if (!std::isfinite(conf_snr)) conf_snr = 0.0;
    // Multiply by (1 - rejection) and penalize high RR CV
    double conf = conf_snr * (1.0 - out.quality.rejectionRate);
    double cv = 0.0;
    if (!out.rrList.empty()) {
        double mean_rr = 0.0; for (double r : out.rrList) mean_rr += r; mean_rr /= (double)out.rrList.size();
        double var_rr = 0.0; for (double r : out.rrList) { double d = r - mean_rr; var_rr += d * d; }
        var_rr /= (double)out.rrList.size(); double sd_rr = std::sqrt(std::max(0.0, var_rr));
        cv = (mean_rr > 1e-9) ? (sd_rr / mean_rr) : 0.0;
        double kcv = activeConf3 ? 0.5 : 1.0;
        conf *= std::max(0.0, 1.0 - kcv * cv);
    }
    if (activeConf3) {
        double activeSecs = 0.0;
        if (softDoublingActive_) activeSecs = std::max(activeSecs, lastTs_ - softStartTs_);
        if (doublingHintActive_ && hintStartTs_ > 0.0) activeSecs = std::max(activeSecs, lastTs_ - hintStartTs_);
        if (out.quality.rejectionRate < 0.03 && cv < 0.12 && activeSecs >= 8.0) conf = std::min(1.0, conf * 1.1);
    }
    // Warm-up gate: require >=15s or >=15 beats before trusting confidence
    bool warmed = ((lastTs_ - firstTsApprox_) >= 15.0) || (out.rrList.size() >= 15);
    if (!warmed) conf = 0.0;
    if (!std::isfinite(conf)) conf = 0.0;
    out.quality.confidence = std::max(0.0, std::min(1.0, conf));
}

} // namespace heartpy
