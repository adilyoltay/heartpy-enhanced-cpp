#include <iostream>
#include <vector>
#include "../cpp/heartpy_core.h"

int main() {
  // RR-only analysis sanity
  std::vector<double> rr = {850, 870, 860, 845, 855, 870, 860, 850, 865, 855};
  heartpy::Options opt;
  opt.cleanRR = true;
  opt.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER;
  auto rrRes = heartpy::analyzeRRIntervals(rr, opt);
  std::cout << "RR-only BPM: " << rrRes.bpm << "\n";
  std::cout << "RR-only SDNN: " << rrRes.sdnn << "\n";

  // Segmentwise analysis sanity
  double fs = 50.0;
  int N = 120 * fs * 2; // 2 minutes * 2 segments
  std::vector<double> sig(N, 0.0);
  const double PI = 3.14159265358979323846;
  for (int i = 0; i < N; ++i) {
    double t = i / fs;
    double hr_hz = 1.2; // ~72 bpm
    sig[i] = std::sin(2 * PI * hr_hz * t);
  }
  heartpy::Options segOpt;
  segOpt.segmentWidth = 60.0; // 1-minute windows
  segOpt.segmentOverlap = 0.5;
  segOpt.rejectSegmentwise = false;
  auto segRes = heartpy::analyzeSignalSegmentwise(sig, fs, segOpt);
  std::cout << "Segments analyzed: " << segRes.segments.size() << "\n";
  std::cout << "Avg BPM: " << segRes.bpm << "\n";
  return 0;
}

