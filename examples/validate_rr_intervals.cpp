#include <iostream>
#include <fstream>
#include <vector>
#include <sstream>
#include <iomanip>
#include <numeric>
#include <chrono>
#include "../cpp/heartpy_core.h"

void printUsage(const char* progName) {
    std::cout << "Usage: " << progName << " <rr_csv_file> [options]\n";
    std::cout << "Options:\n";
    std::cout << "  --clean_rr <method>     Clean RR intervals (quotient-filter|iqr|z-score)\n";
    std::cout << "  --breathing_bpm         Output breathing in BPM instead of Hz\n";
    std::cout << "  --welch_sec <seconds>   Welch window size (default: 240)\n";
    std::cout << "  --help                  Show this help\n";
}

std::vector<double> loadRRFromCSV(const std::string& filename) {
    std::vector<double> rr_intervals;
    std::ifstream file(filename);
    std::string content;
    
    if (!file.is_open()) {
        throw std::runtime_error("Cannot open file: " + filename);
    }
    
    // Read entire file content
    std::string line;
    while (std::getline(file, line)) {
        if (!content.empty()) content += "\n";
        content += line;
    }
    file.close();
    
    // Parse as comma-separated or newline-separated values
    std::stringstream ss(content);
    std::string item;
    
    // Try comma-separated first
    if (content.find(',') != std::string::npos) {
        while (std::getline(ss, item, ',')) {
            item.erase(0, item.find_first_not_of(" \t\r\n"));
            item.erase(item.find_last_not_of(" \t\r\n") + 1);
            if (!item.empty()) {
                try {
                    double value = std::stod(item);
                    if (value > 0 && value < 5000) {  // Reasonable RR range
                        rr_intervals.push_back(value);
                    }
                } catch (const std::exception&) {
                    // Skip invalid values
                }
            }
        }
    } else {
        // Try newline-separated
        ss.clear();
        ss.str(content);
        while (std::getline(ss, item)) {
            item.erase(0, item.find_first_not_of(" \t\r\n"));
            item.erase(item.find_last_not_of(" \t\r\n") + 1);
            if (!item.empty()) {
                try {
                    double value = std::stod(item);
                    if (value > 0 && value < 5000) {  // Reasonable RR range
                        rr_intervals.push_back(value);
                    }
                } catch (const std::exception&) {
                    // Skip invalid values
                }
            }
        }
    }
    
    return rr_intervals;
}

void printJSONResult(const heartpy::HeartMetrics& metrics, const heartpy::Options& opt) {
    std::cout << std::fixed << std::setprecision(6);
    std::cout << "{\n";
    std::cout << "  \"bpm\": " << metrics.bpm << ",\n";
    std::cout << "  \"sdnn\": " << metrics.sdnn << ",\n";
    std::cout << "  \"rmssd\": " << metrics.rmssd << ",\n";
    std::cout << "  \"sdsd\": " << metrics.sdsd << ",\n";
    std::cout << "  \"pnn20\": " << metrics.pnn20 << ",\n";
    std::cout << "  \"pnn50\": " << metrics.pnn50 << ",\n";
    std::cout << "  \"nn20\": " << metrics.nn20 << ",\n";
    std::cout << "  \"nn50\": " << metrics.nn50 << ",\n";
    std::cout << "  \"mad\": " << metrics.mad << ",\n";
    std::cout << "  \"sd1\": " << metrics.sd1 << ",\n";
    std::cout << "  \"sd2\": " << metrics.sd2 << ",\n";
    std::cout << "  \"sd1sd2_ratio\": " << metrics.sd1sd2Ratio << ",\n";
    std::cout << "  \"ellipse_area\": " << metrics.ellipseArea << ",\n";
    std::cout << "  \"vlf\": " << metrics.vlf << ",\n";
    std::cout << "  \"lf\": " << metrics.lf << ",\n";
    std::cout << "  \"hf\": " << metrics.hf << ",\n";
    std::cout << "  \"lf_hf\": " << metrics.lfhf << ",\n";
    std::cout << "  \"total_power\": " << metrics.totalPower << ",\n";
    std::cout << "  \"lf_norm\": " << metrics.lfNorm << ",\n";
    std::cout << "  \"hf_norm\": " << metrics.hfNorm << ",\n";
    
    // Breathing rate output based on options
    double breathing_output = metrics.breathingRate;
    if (opt.breathingAsBpm && breathing_output < 2.0) {
        breathing_output *= 60.0;  // Convert Hz to BPM
    }
    
    std::cout << "  \"breathing_rate\": " << breathing_output << ",\n";
    std::cout << "  \"quality\": {\n";
    std::cout << "    \"total_beats\": " << metrics.quality.totalBeats << ",\n";
    std::cout << "    \"rejected_beats\": " << metrics.quality.rejectedBeats << ",\n";
    std::cout << "    \"rejection_rate\": " << metrics.quality.rejectionRate << ",\n";
    std::cout << "    \"good_quality\": " << (metrics.quality.goodQuality ? "true" : "false");
    if (!metrics.quality.qualityWarning.empty()) {
        std::cout << ",\n    \"warning\": \"" << metrics.quality.qualityWarning << "\"";
    }
    std::cout << "\n  },\n";
    std::cout << "  \"rr_count\": " << metrics.rrList.size() << ",\n";
    std::cout << "  \"original_count\": " << metrics.ibiMs.size() << "\n";
    std::cout << "}\n";
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        printUsage(argv[0]);
        return 1;
    }
    
    std::string filename = argv[1];
    heartpy::Options options;
    
    // Parse command line options
    for (int i = 2; i < argc; i++) {
        std::string arg = argv[i];
        
        if (arg == "--help") {
            printUsage(argv[0]);
            return 0;
        } else if (arg == "--clean_rr" && i + 1 < argc) {
            options.cleanRR = true;
            std::string method = argv[++i];
            if (method == "iqr") {
                options.cleanMethod = heartpy::Options::CleanMethod::IQR;
            } else if (method == "z-score") {
                options.cleanMethod = heartpy::Options::CleanMethod::Z_SCORE;
            } else {
                options.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER;
            }
        } else if (arg == "--breathing_bpm") {
            options.breathingAsBpm = true;
        } else if (arg == "--welch_sec" && i + 1 < argc) {
            options.welchWsizeSec = std::stod(argv[++i]);
        }
    }
    
    try {
        // Load RR intervals from CSV
        std::vector<double> rr_intervals = loadRRFromCSV(filename);
        
        if (rr_intervals.empty()) {
            std::cerr << "Error: No valid RR intervals found in " << filename << std::endl;
            return 1;
        }
        
        // Print basic info to stderr (so JSON output stays clean)
        std::cerr << "Loaded " << rr_intervals.size() << " RR intervals" << std::endl;
        std::cerr << "Mean RR: " << std::accumulate(rr_intervals.begin(), rr_intervals.end(), 0.0) / rr_intervals.size() << " ms" << std::endl;
        
        // Analyze using HeartPy Enhanced
        auto start_time = std::chrono::high_resolution_clock::now();
        heartpy::HeartMetrics result = heartpy::analyzeRRIntervals(rr_intervals, options);
        auto end_time = std::chrono::high_resolution_clock::now();
        
        auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end_time - start_time);
        std::cerr << "Analysis time: " << duration.count() / 1000.0 << " ms" << std::endl;
        
        // Output results as JSON
        printJSONResult(result, options);
        
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    }
}
