#include "../cpp/heartpy_core.h"

#include <iostream>
#include <vector>
#include <cmath>

int main() {
    // RR intervals in ms with a clear outlier (1600 ms)
    std::vector<double> rr = {800, 800, 1600, 800, 800};

    heartpy::Options o1; // default: thresholdRR=false
    auto a = heartpy::analyzeRRIntervals(rr, o1);

    heartpy::Options o2; o2.thresholdRR = true;
    auto b = heartpy::analyzeRRIntervals(rr, o2);

    // Expect masked RMSSD to be lower than unmasked due to outlier exclusion
    bool ok = std::isfinite(a.rmssd) && std::isfinite(b.rmssd) && (b.rmssd < a.rmssd);
    std::cout << (ok ? "OK" : "FAIL") << " rmssd_no_mask=" << a.rmssd << " rmssd_masked=" << b.rmssd << "\n";
    return ok ? 0 : 1;
}

