#pragma once

#include <vector>

namespace heartpy {

struct Options {
	// Bandpass in Hz
	double lowHz = 0.5;
	double highHz = 5.0;
	int iirOrder = 2;

	// Welch PSD
	int nfft = 256;
	double overlap = 0.5; // 0..1

	// Peak detection
	double refractoryMs = 250.0; // minimum distance between peaks
	double thresholdScale = 0.5; // adaptive threshold scale
};

struct HeartMetrics {
	double bpm = 0.0;
	std::vector<double> ibiMs; // inter-beat intervals in ms

	// time domain
	double sdnn = 0.0;
	double rmssd = 0.0;
	double sdsd = 0.0;
	double pnn20 = 0.0;
	double pnn50 = 0.0;
	double sd1 = 0.0;
	double sd2 = 0.0;

	// frequency domain (Welch)
	double vlf = 0.0;
	double lf = 0.0;
	double hf = 0.0;
	double lfhf = 0.0;
};

// Main API: analyze a raw PPG/ECG vector with sampling frequency fs (Hz)
HeartMetrics analyzeSignal(const std::vector<double>& signal, double fs, const Options& opt = {});

}


