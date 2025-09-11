#include "heartpy_core.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>

namespace heartpy {

namespace {

static constexpr double PI = 3.141592653589793238462643383279502884;

static inline double clamp(double v, double lo, double hi) {
	return std::max(lo, std::min(hi, v));
}

std::vector<double> movingAverageDetrend(const std::vector<double>& x, int window) {
	if (window <= 1) return x;
	const int n = static_cast<int>(x.size());
	std::vector<double> out(n);
	std::vector<double> cumsum(n + 1, 0.0);
	for (int i = 0; i < n; ++i) cumsum[i + 1] = cumsum[i] + x[i];
	for (int i = 0; i < n; ++i) {
		int start = std::max(0, i - window / 2);
		int end = std::min(n, i + (window - window / 2));
		double mean = (cumsum[end] - cumsum[start]) / std::max(1, end - start);
		out[i] = x[i] - mean;
	}
	return out;
}

struct Biquad {
	double b0{0}, b1{0}, b2{0}, a1{0}, a2{0};
	double z1{0}, z2{0};
	double process(double in) {
		double out = in * b0 + z1;
		z1 = in * b1 + z2 - a1 * out;
		z2 = in * b2 - a2 * out;
		return out;
	}
};

Biquad designBandpass(double fs, double f0, double Q) {
	const double w0 = 2.0 * PI * f0 / fs;
	const double alpha = std::sin(w0) / (2.0 * Q);
	const double cosw0 = std::cos(w0);
	Biquad bi;
	double b0 =   alpha;
	double b1 =   0.0;
	double b2 =  -alpha;
	double a0 =   1.0 + alpha;
	double a1 =  -2.0 * cosw0;
	double a2 =   1.0 - alpha;
	bi.b0 = b0 / a0;
	bi.b1 = b1 / a0;
	bi.b2 = b2 / a0;
	bi.a1 = a1 / a0;
	bi.a2 = a2 / a0;
	return bi;
}

std::vector<double> bandpassFilter(const std::vector<double>& x, double fs, double lowHz, double highHz, int order) {
	if (lowHz <= 0.0 && highHz <= 0.0) return x;
	const int n = static_cast<int>(x.size());
	std::vector<double> y = x;
	const int sections = std::max(1, order);
	for (int s = 0; s < sections; ++s) {
		double f0 = lowHz + (highHz - lowHz) * (s + 0.5) / sections;
		double bw = (highHz - lowHz);
		double Q = (bw > 0.0 && f0 > 0.0) ? f0 / bw : 0.707;
		Biquad bi = designBandpass(fs, clamp(f0, 0.001, fs * 0.45), std::max(0.2, Q));
		for (int i = 0; i < n; ++i) y[i] = bi.process(y[i]);
	}
	return y;
}

std::vector<int> detectPeaks(const std::vector<double>& x, double fs, double refractoryMs, double scale) {
	const int n = static_cast<int>(x.size());
	std::vector<int> peaks;
	if (n == 0) return peaks;
	const int refSamples = static_cast<int>(std::round(refractoryMs * 0.001 * fs));
	const int win = std::max(5, static_cast<int>(std::round(0.5 * fs)));
	std::vector<double> cumsum(n + 1, 0.0), csumsq(n + 1, 0.0);
	for (int i = 0; i < n; ++i) {
		cumsum[i + 1] = cumsum[i] + x[i];
		csumsq[i + 1] = csumsq[i] + x[i] * x[i];
	}
	int lastPeak = -refSamples - 1;
	for (int i = 1; i < n - 1; ++i) {
		int start = std::max(0, i - win);
		int end = std::min(n, i + win);
		int count = std::max(1, end - start);
		double mean = (cumsum[end] - cumsum[start]) / count;
		double var = (csumsq[end] - csumsq[start]) / count - mean * mean;
		double sd = std::sqrt(std::max(0.0, var));
		double thr = mean + scale * sd;
		bool isPeak = (x[i] > thr) && (x[i] > x[i - 1]) && (x[i] >= x[i + 1]);
		if (isPeak && (i - lastPeak >= refSamples)) {
			peaks.push_back(i);
			lastPeak = i;
		}
	}
	return peaks;
}

double mean(const std::vector<double>& v) {
	if (v.empty()) return 0.0;
	double s = std::accumulate(v.begin(), v.end(), 0.0);
	return s / static_cast<double>(v.size());
}

double sd(const std::vector<double>& v) {
	if (v.size() <= 1) return 0.0;
	double m = mean(v);
	double acc = 0.0;
	for (double x : v) {
		double d = x - m;
		acc += d * d;
	}
	return std::sqrt(acc / static_cast<double>(v.size() - 1));
}

struct PSDResult { std::vector<double> freqs; std::vector<double> psd; };

PSDResult welchPSD(const std::vector<double>& x, double fs, int nfft, double overlap) {
	const int n = static_cast<int>(x.size());
	if (nfft <= 0) nfft = 256;
	const int hop = std::max(1, nfft - static_cast<int>(std::round(overlap * nfft)));
	if (n < nfft) return {{}, {}};
	std::vector<double> window(nfft);
	for (int i = 0; i < nfft; ++i) window[i] = 0.54 - 0.46 * std::cos(2.0 * PI * i / (nfft - 1));
	const double winNorm = std::accumulate(window.begin(), window.end(), 0.0) / nfft;
	const int nseg = 1 + (n - nfft) / hop;
	int kmax = nfft / 2 + 1;
	std::vector<double> psd(kmax, 0.0);
	for (int s = 0; s < nseg; ++s) {
		int start = s * hop;
		for (int k = 0; k < kmax; ++k) {
			double real = 0.0, imag = 0.0;
			for (int t = 0; t < nfft; ++t) {
				double sample = x[start + t] * window[t];
				double ang = -2.0 * PI * k * t / nfft;
				real += sample * std::cos(ang);
				imag += sample * std::sin(ang);
			}
			double p = (real * real + imag * imag) / (nfft * fs * winNorm * winNorm);
			psd[k] += p;
		}
	}
	for (double& v : psd) v /= std::max(1, nseg);
	std::vector<double> freqs(kmax);
	for (int k = 0; k < kmax; ++k) freqs[k] = (fs * k) / nfft;
	return {freqs, psd};
}

double integrateBand(const std::vector<double>& f, const std::vector<double>& p, double lo, double hi) {
	double area = 0.0;
	for (size_t i = 1; i < f.size(); ++i) {
		double f1 = f[i - 1], f2 = f[i];
		double c1 = clamp((f1 - lo) / (hi - lo), 0.0, 1.0);
		double c2 = clamp((f2 - lo) / (hi - lo), 0.0, 1.0);
		if (c1 <= 0.0 && c2 <= 0.0) continue;
		if (c1 >= 1.0 && c2 >= 1.0) continue;
		double w1 = (f1 >= lo && f1 <= hi) ? 1.0 : 0.0;
		double w2 = (f2 >= lo && f2 <= hi) ? 1.0 : 0.0;
		double base = f2 - f1;
		double h = 0.5 * (p[i - 1] * w1 + p[i] * w2);
		area += base * h;
	}
	return area;
}

} // namespace

HeartMetrics analyzeSignal(const std::vector<double>& signal, double fs, const Options& opt) {
	if (signal.empty()) throw std::invalid_argument("signal is empty");
	if (fs <= 0.0) throw std::invalid_argument("fs must be > 0");
	int detrendWin = std::max(5, static_cast<int>(std::round(0.75 * fs)));
	std::vector<double> x = movingAverageDetrend(signal, detrendWin);
	x = bandpassFilter(x, fs, opt.lowHz, opt.highHz, opt.iirOrder);
	std::vector<int> peaks = detectPeaks(x, fs, opt.refractoryMs, opt.thresholdScale);
	HeartMetrics m;
	for (size_t i = 1; i < peaks.size(); ++i) {
		double ibiMs = (peaks[i] - peaks[i - 1]) * 1000.0 / fs;
		if (ibiMs > 250.0 && ibiMs < 2000.0) m.ibiMs.push_back(ibiMs);
	}
	if (!m.ibiMs.empty()) {
		double meanIbi = mean(m.ibiMs);
		m.bpm = 60000.0 / meanIbi;
	}
	m.sdnn = sd(m.ibiMs);
	if (m.ibiMs.size() >= 2) {
		std::vector<double> diff;
		diff.reserve(m.ibiMs.size() - 1);
		for (size_t i = 1; i < m.ibiMs.size(); ++i) diff.push_back(m.ibiMs[i] - m.ibiMs[i - 1]);
		m.sdsd = sd(diff);
		double sumsq = 0.0;
		int over20 = 0;
		int over50 = 0;
		for (double d : diff) {
			sumsq += d * d;
			if (std::fabs(d) > 20.0) ++over20;
			if (std::fabs(d) > 50.0) ++over50;
		}
		m.rmssd = std::sqrt(sumsq / static_cast<double>(diff.size()));
		m.pnn20 = diff.empty() ? 0.0 : (100.0 * over20 / static_cast<double>(diff.size()));
		m.pnn50 = diff.empty() ? 0.0 : (100.0 * over50 / static_cast<double>(diff.size()));
		m.sd1 = m.rmssd / std::sqrt(2.0);
		double sd_diff = sd(diff);
		m.sd2 = std::sqrt(std::max(0.0, 2.0 * m.sdnn * m.sdnn - 0.5 * sd_diff * sd_diff));
	}
	if (m.ibiMs.size() >= 3) {
		std::vector<double> t; t.reserve(peaks.size());
		for (int idx : peaks) t.push_back(idx / fs);
		std::vector<double> ibiSec; for (double v : m.ibiMs) ibiSec.push_back(v / 1000.0);
		if (ibiSec.size() + 1 <= t.size()) {
			double duration = t.back() - t.front();
			double targetFs = 4.0;
			int N = std::max(0, static_cast<int>(std::floor(duration * targetFs)));
			if (N > opt.nfft) N = std::max(N, opt.nfft);
			std::vector<double> reg(N);
			if (N > 0) {
				std::vector<double> ibiPerPeak; ibiPerPeak.push_back(ibiSec.front());
				for (size_t i = 1; i < ibiSec.size(); ++i) ibiPerPeak.push_back(ibiSec[i]);
				double dt = 1.0 / targetFs;
				for (int i = 0; i < N; ++i) {
					double time = t.front() + i * dt;
					size_t k = 1; while (k < t.size() && t[k] < time) ++k; if (k >= t.size()) k = t.size() - 1;
					double t1 = t[k - 1], t2 = t[k];
					double v1 = ibiPerPeak[std::min(k - 1, ibiPerPeak.size() - 1)];
					double v2 = ibiPerPeak[std::min(k, ibiPerPeak.size() - 1)];
					double alpha = (t2 - t1) > 0 ? (time - t1) / (t2 - t1) : 0.0;
					reg[i] = v1 + alpha * (v2 - v1);
				}
				reg = movingAverageDetrend(reg, static_cast<int>(std::round(2.0 * targetFs)));
				PSDResult psd = welchPSD(reg, targetFs, opt.nfft, opt.overlap);
				if (!psd.freqs.empty()) {
					m.vlf = integrateBand(psd.freqs, psd.psd, 0.0033, 0.04);
					m.lf  = integrateBand(psd.freqs, psd.psd, 0.04,   0.15);
					m.hf  = integrateBand(psd.freqs, psd.psd, 0.15,   0.40);
					m.lfhf = (m.hf > 1e-12) ? (m.lf / m.hf) : 0.0;
				}
			}
		}
	}
	return m;
}

} // namespace heartpy


