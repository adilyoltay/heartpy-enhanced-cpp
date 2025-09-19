#include <iostream>
#include <vector>
#include <cmath>
#include <string>
#include "../cpp/heartpy_core.h"

static void print_json_string(const std::string &k, const std::string &v, bool last=false) {
  std::cout << "\"" << k << "\":\"" << v << "\"" << (last?"":" ,");
}
static void print_json_number(const std::string &k, double v, bool last=false) {
  std::cout << "\"" << k << "\":" << v << (last?"":" ,");
}
static void print_json_int(const std::string &k, int v, bool last=false) {
  std::cout << "\"" << k << "\":" << v << (last?"":" ,");
}

int main() {
  const double fs = 100.0;
  const std::vector<double> data = {
    -0.125, 0.035, 0.194, 0.35, 0.5, 0.638, 0.76, 0.86, 0.939, 0.989,
    1.0, 0.97, 0.9, 0.793, 0.655, 0.491, 0.309, 0.118, -0.08, -0.27,
    -0.45, -0.62, -0.76, -0.87, -0.95, -0.99, -0.99, -0.95, -0.86, -0.74,
    -0.58, -0.4, -0.2, -0.0, 0.203, 0.398, 0.58, 0.74, 0.87, 0.96,
    1.0, 0.99, 0.94, 0.84, 0.7, 0.53, 0.33, 0.12, -0.1, -0.3, -0.5,
    -0.67, -0.8, -0.9, -0.96, -0.98, -0.95, -0.88, -0.77, -0.62, -0.44,
    -0.24, -0.02, 0.19, 0.39, 0.58, 0.74, 0.87, 0.96, 1.0, 0.99, 0.94,
    0.84, 0.7, 0.53, 0.33, 0.12, -0.1, -0.3, -0.5, -0.67, -0.8, -0.9,
    -0.96, -0.98, -0.95, -0.88, -0.77, -0.62, -0.44, -0.24, -0.02, 0.19,
    0.39, 0.58, 0.74, 0.87, 0.96, 1.0, 0.99, 0.94, 0.84, 0.7, 0.53,
    0.33, 0.12, -0.1, -0.3, -0.5, -0.67, -0.8, -0.9, -0.96, -0.98, -0.95,
    -0.88, -0.77, -0.62, -0.44, -0.24, -0.02, 0.19, 0.39, 0.58, 0.74,
    0.87, 0.96, 1.0, 0.99, 0.94, 0.84, 0.7, 0.53, 0.33, 0.12, -0.1,
    -0.3, -0.5, -0.67, -0.8, -0.9, -0.96, -0.98, -0.95, -0.88, -0.77,
    -0.62, -0.44, -0.24, -0.02, 0.19, 0.39, 0.58, 0.74, 0.87, 0.96,
    1.0, 0.99, 0.94, 0.84, 0.7, 0.53, 0.33, 0.12, -0.1, -0.3, -0.5,
    -0.67, -0.8, -0.9, -0.96, -0.98, -0.95, -0.88, -0.77, -0.62, -0.44,
    -0.24, -0.02, 0.19, 0.39, 0.58, 0.74, 0.87, 0.96, 1.0, 0.99, 0.94,
    0.84, 0.7, 0.53, 0.33, 0.12, -0.1, -0.3, -0.5, -0.67, -0.8, -0.9,
    -0.96, -0.98, -0.95, -0.88, -0.77, -0.62, -0.44, -0.24, -0.02, 0.19,
    0.39, 0.58, 0.74, 0.87, 0.96, 1.0, 0.99, 0.94, 0.84, 0.7, 0.53
  };

  heartpy::Options opt;
  opt.lowHz = 0.5; opt.highHz = 5.0; opt.iirOrder = 2;
  opt.refractoryMs = 250.0; opt.thresholdScale = 0.8;
  opt.bpmMin = 30.0; opt.bpmMax = 240.0;
  auto res = heartpy::analyzeSignal(data, fs, opt);

  std::cout << "{";
  print_json_number("bpm", res.bpm);
  print_json_int("n_peaks", (int)res.peakList.size());
  print_json_number("sdnn", res.sdnn);
  print_json_number("rmssd", res.rmssd);
  print_json_number("pnn50", res.pnn50);
  print_json_number("vlf", res.vlf);
  print_json_number("lf", res.lf);
  print_json_number("hf", res.hf);
  print_json_number("lf_hf", res.lfhf);
  print_json_number("breathingrate", res.breathingRate, true);
  std::cout << "}\n";
  return 0;
}
