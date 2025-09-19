#include <iostream>
#include <vector>
#include <cmath>
#include "../cpp/heartpy_core.h"

int main() {
	// synthesize a simple PPG-like signal with ~1.2 Hz heart rate
	double fs = 50.0;
	int N = 5000;
	std::vector<double> x(N);
	const double PI = 3.141592653589793238462643383279502884;
	for (int i = 0; i < N; ++i) {
		double t = i / fs;
		double hr = 1.2; // Hz
		x[i] = std::sin(2.0 * PI * hr * t) + 0.1 * std::sin(2.0 * PI * 50.0 * t);
	}

	heartpy::Options opt;
	opt.lowHz = 0.5;
	opt.highHz = 5.0;
	opt.iirOrder = 2;
	opt.nfft = 256;
	opt.overlap = 0.5;

	auto res = heartpy::analyzeSignal(x, fs, opt);
	std::cout << "BPM: " << res.bpm << "\n";
	std::cout << "SDNN: " << res.sdnn << " ms\n";
	std::cout << "RMSSD: " << res.rmssd << " ms\n";
	std::cout << "LF/HF: " << res.lfhf << "\n";
	return 0;
}


