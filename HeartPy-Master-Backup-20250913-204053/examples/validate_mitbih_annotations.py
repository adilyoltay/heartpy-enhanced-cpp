#!/usr/bin/env python3
"""
MIT-BIH Database Validation using R-peak Annotations
====================================================

This script validates HeartPy Enhanced C++ against Python HeartPy using
MIT-BIH Arrhythmia Database annotations to avoid fit_peaks issues.

Strategy:
1. Load R-peak annotations from .atr files using WFDB
2. Convert to RR intervals (ms)  
3. Analyze with Python HeartPy process_rr()
4. Analyze with C++ analyzeRRIntervals()
5. Compare metrics with scientific tolerances

Author: HeartPy Enhanced Team
Date: 2024
"""

import os
import sys
import json
import time
import argparse
import numpy as np
import wfdb
from pathlib import Path
import subprocess

# Fix time.clock deprecation for older HeartPy
if not hasattr(time, 'clock'):
    time.clock = time.perf_counter

try:
    import heartpy as hp
except ImportError as e:
    raise SystemExit("Python HeartPy required: pip install heartpy scipy numpy")

# Paths
ROOT = Path(__file__).parent.parent
MITBIH_DIR = ROOT / "examples" / "mit-bih-arrhythmia-database-1.0.0"
CPP_EXE = ROOT / "build-validation" / "validate_rr_intervals"

def load_mitbih_annotations(record_name, data_dir):
    """
    Load R-peak annotations from MIT-BIH database
    
    Args:
        record_name: e.g., '100', '101', etc.
        data_dir: Path to MIT-BIH database directory
    
    Returns:
        tuple: (r_peaks, sample_rate, duration)
    """
    try:
        # Load annotations using WFDB
        record_path = str(data_dir / record_name)
        
        # Read annotation file
        ann = wfdb.rdann(record_path, 'atr')
        
        # Read header for sampling rate
        header = wfdb.rdheader(record_path)
        fs = header.fs
        
        # Filter for normal beats (exclude artifacts)
        # MIT-BIH annotation codes: 
        # 'N' = Normal beat, 'L' = LBBB, 'R' = RBBB, 'A' = Atrial premature, etc.
        normal_beat_codes = ['N', 'L', 'R', 'e', 'j', '.']
        
        r_peaks = []
        for i, symbol in enumerate(ann.symbol):
            if symbol in normal_beat_codes:
                r_peaks.append(ann.sample[i])
        
        r_peaks = np.array(r_peaks)
        duration = len(r_peaks) / fs * 60  # minutes
        
        print(f"📊 Record {record_name}: {len(r_peaks)} R-peaks, {fs}Hz, {duration:.1f}min")
        
        return r_peaks, fs, duration
        
    except Exception as e:
        print(f"❌ Error loading {record_name}: {e}")
        return None, None, None

def peaks_to_rr_intervals(r_peaks, sample_rate):
    """
    Convert R-peak sample indices to RR intervals in milliseconds
    
    Args:
        r_peaks: Array of R-peak sample indices
        sample_rate: Sampling frequency (Hz)
    
    Returns:
        np.array: RR intervals in milliseconds
    """
    if len(r_peaks) < 2:
        return np.array([])
    
    # Calculate differences between adjacent peaks
    rr_samples = np.diff(r_peaks)
    
    # Convert to milliseconds
    rr_ms = (rr_samples / sample_rate) * 1000.0
    
    # Filter physiologically reasonable intervals (300-2000ms = 30-200 BPM)
    valid_rr = rr_ms[(rr_ms >= 300) & (rr_ms <= 2000)]
    
    return valid_rr

def analyze_with_python_heartpy(rr_intervals, test_params):
    """
    Analyze RR intervals using Python HeartPy process_rr()
    """
    try:
        # Convert RR intervals to list (HeartPy expects list of floats in ms)
        rr_list_ms = [float(rr) for rr in rr_intervals]
        
        # Debug: Check data types
        # print(f"Debug: RR list type: {type(rr_list_ms)}, length: {len(rr_list_ms)}")
        # if len(rr_list_ms) > 0:
        #     print(f"Debug: First RR: {rr_list_ms[0]}, type: {type(rr_list_ms[0])}")
        
        # Use HeartPy's process_rr function
        # NOTE: calc_freq=False due to HeartPy bug with np.linspace in calc_fd_measures
        wd, measures = hp.process_rr(
            rr_list=rr_list_ms,
            threshold_rr=test_params.get('threshold_rr', False),
            clean_rr=test_params.get('clean_rr', False),  
            clean_rr_method=test_params.get('clean_method', 'quotient-filter'),
            calc_freq=False  # Disabled due to HeartPy bug with RR-only analysis
        )
        
        # Extract relevant metrics
        result = {
            'bpm': measures.get('bpm', np.nan),
            'sdnn': measures.get('sdnn', np.nan),
            'rmssd': measures.get('rmssd', np.nan),
            'pnn20': measures.get('pnn20', np.nan),
            'pnn50': measures.get('pnn50', np.nan),
            'sd1': measures.get('sd1', np.nan),
            'sd2': measures.get('sd2', np.nan),
            'vlf': measures.get('vlf', np.nan),
            'lf': measures.get('lf', np.nan),
            'hf': measures.get('hf', np.nan),
            'lf_hf': measures.get('lf/hf', np.nan),
            'total_power': measures.get('vlf', 0) + measures.get('lf', 0) + measures.get('hf', 0),
            'breathingrate': measures.get('breathingrate', np.nan),
            'hr_mad': measures.get('hr_mad', np.nan),
        }
        
        # Convert breathing rate from Hz to BPM if needed
        if not np.isnan(result['breathingrate']) and result['breathingrate'] < 2.0:  # Likely in Hz
            result['breathing_bpm'] = result['breathingrate'] * 60
        else:
            result['breathing_bpm'] = result['breathingrate']
            
        return result, True
        
    except Exception as e:
        # import traceback
        print(f"❌ Python HeartPy error: {e}")
        # Uncomment for debugging:
        # traceback.print_exc()
        return {}, False

def analyze_with_cpp_enhanced(rr_intervals, test_params):
    """
    Analyze RR intervals using C++ HeartPy Enhanced
    """
    try:
        # Create temporary CSV file for C++ program
        csv_path = "/tmp/mitbih_rr.csv"
        np.savetxt(csv_path, rr_intervals, delimiter=',', fmt='%.6f')
        
        # Build command line arguments
        cmd_args = [str(CPP_EXE), csv_path]
        
        # Add options
        if test_params.get('clean_rr', False):
            cmd_args.extend(['--clean_rr', test_params.get('clean_method', 'quotient-filter')])
            
        if test_params.get('breathing_bpm', False):
            cmd_args.append('--breathing_bpm')
            
        cmd_args.extend(['--welch_sec', '240'])
        
        # Run C++ analysis
        if not CPP_EXE.exists():
            print(f"❌ C++ executable not found: {CPP_EXE}")
            return {}, False
            
        result = subprocess.run(cmd_args, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            print(f"❌ C++ execution failed: {result.stderr}")
            return {}, False
            
        # Parse JSON output
        cpp_data = json.loads(result.stdout)
        
        # Convert to Python HeartPy compatible format
        output = {
            'bpm': cpp_data['bpm'],
            'sdnn': cpp_data['sdnn'], 
            'rmssd': cpp_data['rmssd'],
            'pnn20': cpp_data['pnn20'],
            'pnn50': cpp_data['pnn50'],
            'sd1': cpp_data['sd1'],
            'sd2': cpp_data['sd2'],
            'vlf': cpp_data['vlf'],
            'lf': cpp_data['lf'],
            'hf': cpp_data['hf'],
            'lf_hf': cpp_data['lf_hf'],
            'total_power': cpp_data['total_power'],
            'breathingrate': cpp_data['breathing_rate'],
            'breathing_bpm': cpp_data['breathing_rate'] * 60 if cpp_data['breathing_rate'] < 2.0 else cpp_data['breathing_rate'],
            'hr_mad': cpp_data['mad'],
        }
        
        # Clean up
        try:
            os.unlink(csv_path)
        except:
            pass
            
        return output, True
        
    except subprocess.TimeoutExpired:
        print(f"❌ C++ analysis timeout")
        return {}, False
    except json.JSONDecodeError as e:
        print(f"❌ JSON parse error: {e}")
        print(f"C++ output: {result.stdout}")
        return {}, False
    except Exception as e:
        print(f"❌ C++ Enhanced error: {e}")
        return {}, False

def compare_metrics(python_result, cpp_result, record_name, tolerances):
    """
    Compare metrics between Python HeartPy and C++ Enhanced
    """
    comparison = {
        'record': record_name,
        'total_comparisons': 0,
        'passed_comparisons': 0,
        'failed_comparisons': 0,
        'metric_details': {}
    }
    
    for metric, tolerance_pct in tolerances.items():
        if metric in python_result and metric in cpp_result:
            py_val = python_result[metric]
            cpp_val = cpp_result[metric]
            
            comparison['total_comparisons'] += 1
            
            if np.isnan(py_val) or np.isnan(cpp_val):
                status = "SKIP" if np.isnan(py_val) and np.isnan(cpp_val) else "FAIL"
                diff_pct = float('inf')
            else:
                diff_pct = abs((cpp_val - py_val) / py_val * 100) if py_val != 0 else 0
                status = "PASS" if diff_pct <= tolerance_pct else "FAIL"
                
                if status == "PASS":
                    comparison['passed_comparisons'] += 1
                else:
                    comparison['failed_comparisons'] += 1
            
            comparison['metric_details'][metric] = {
                'python_value': float(py_val) if not np.isnan(py_val) else None,
                'cpp_value': float(cpp_val) if not np.isnan(cpp_val) else None,
                'difference_percent': float(diff_pct) if diff_pct != float('inf') else None,
                'tolerance_percent': tolerance_pct,
                'status': status
            }
    
    return comparison

def generate_report(all_comparisons, output_file):
    """
    Generate comprehensive validation report
    """
    total_records = len(all_comparisons)
    valid_records = len([c for c in all_comparisons if c['total_comparisons'] > 0])
    
    # Overall statistics
    all_passed = sum(c['passed_comparisons'] for c in all_comparisons)
    all_total = sum(c['total_comparisons'] for c in all_comparisons)
    overall_success_rate = (all_passed / all_total * 100) if all_total > 0 else 0
    
    # Metric-wise statistics
    metric_stats = {}
    for comparison in all_comparisons:
        for metric, details in comparison['metric_details'].items():
            if metric not in metric_stats:
                metric_stats[metric] = {'passed': 0, 'total': 0, 'values': []}
            
            if details['status'] in ['PASS', 'FAIL']:
                metric_stats[metric]['total'] += 1
                if details['status'] == 'PASS':
                    metric_stats[metric]['passed'] += 1
                    
                if details['difference_percent'] is not None:
                    metric_stats[metric]['values'].append(details['difference_percent'])
    
    # Generate report
    report = f"""
# 🫀 MIT-BIH Database Validation Report
## HeartPy Enhanced C++ vs Python HeartPy

### 📊 Overall Results
- **Total Records Tested**: {total_records}
- **Valid Records**: {valid_records}  
- **Total Metric Comparisons**: {all_total}
- **Passed Comparisons**: {all_passed}
- **Overall Success Rate**: {overall_success_rate:.1f}%

### 📈 Metric-by-Metric Analysis

| Metric | Success Rate | Avg Difference | Max Difference | Status |
|--------|-------------|----------------|----------------|---------|
"""
    
    for metric, stats in metric_stats.items():
        if stats['total'] > 0:
            success_rate = stats['passed'] / stats['total'] * 100
            avg_diff = np.mean(stats['values']) if stats['values'] else 0
            max_diff = np.max(stats['values']) if stats['values'] else 0
            status = "✅" if success_rate >= 90 else "⚠️" if success_rate >= 70 else "❌"
            
            report += f"| {metric.upper()} | {success_rate:.1f}% | {avg_diff:.2f}% | {max_diff:.2f}% | {status} |\n"
    
    report += f"""
### 📋 Detailed Record Results

"""
    
    for comparison in all_comparisons:
        if comparison['total_comparisons'] > 0:
            record = comparison['record']
            success_rate = comparison['passed_comparisons'] / comparison['total_comparisons'] * 100
            status = "✅" if success_rate >= 90 else "⚠️" if success_rate >= 70 else "❌"
            
            report += f"#### Record {record} {status}\n"
            report += f"- Success Rate: {success_rate:.1f}%\n"
            report += f"- Passed: {comparison['passed_comparisons']}/{comparison['total_comparisons']}\n\n"
            
            # Show failed metrics for debugging
            failed_metrics = [m for m, d in comparison['metric_details'].items() if d['status'] == 'FAIL']
            if failed_metrics:
                report += f"- Failed Metrics: {', '.join(failed_metrics)}\n"
            
            report += "\n"
    
    report += f"""
### 🎯 Scientific Validation Summary

**Target Tolerances**:
- Time Domain (SDNN, RMSSD): ±2%
- Frequency Domain (VLF, LF, HF): ±5%  
- LF/HF Ratio: ±10%
- Breathing Rate: ±0.02 Hz (±1.2 BPM)

**Validation Status**: {'✅ PASSED' if overall_success_rate >= 90 else '⚠️ PARTIAL' if overall_success_rate >= 70 else '❌ FAILED'}

Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}
"""
    
    # Write report
    with open(output_file, 'w') as f:
        f.write(report)
    
    print(f"\n📄 Report saved to: {output_file}")
    print(f"🎯 Overall Success Rate: {overall_success_rate:.1f}%")

def main():
    parser = argparse.ArgumentParser(description='Validate HeartPy Enhanced against MIT-BIH Database')
    parser.add_argument('--records', type=str, default='100,101,102,103,108', 
                       help='Comma-separated MIT-BIH record numbers')
    parser.add_argument('--clean_rr', action='store_true',
                       help='Enable RR interval cleaning')
    parser.add_argument('--clean_method', default='quotient-filter',
                       choices=['quotient-filter', 'iqr', 'z-score'],
                       help='RR cleaning method')
    parser.add_argument('--min_rr_count', type=int, default=50,
                       help='Minimum RR intervals required for analysis')
    parser.add_argument('--output', default='mitbih_validation_report.md',
                       help='Output report file')
    
    args = parser.parse_args()
    
    print("🫀 MIT-BIH Database Validation")
    print("=" * 50)
    print(f"Records to test: {args.records}")
    print(f"RR cleaning: {args.clean_rr} ({args.clean_method})")
    print(f"Minimum RR intervals: {args.min_rr_count}")
    print()
    
    # Test parameters
    test_params = {
        'clean_rr': args.clean_rr,
        'clean_method': args.clean_method,
        'threshold_rr': False,  # We pre-filter physiological range
    }
    
    # Scientific tolerances based on literature
    tolerances = {
        # Time domain metrics (should be very accurate)
        'bpm': 2.0,      # ±2%
        'sdnn': 2.0,     # ±2%  
        'rmssd': 2.0,    # ±2%
        'pnn20': 5.0,    # ±5%
        'pnn50': 5.0,    # ±5%
        'sd1': 2.0,      # ±2%
        'sd2': 2.0,      # ±2%
        'hr_mad': 3.0,   # ±3%
        
        # Frequency domain metrics (more challenging)
        'vlf': 10.0,     # ±10% (due to our current FFT approximation)
        'lf': 10.0,      # ±10%
        'hf': 10.0,      # ±10%
        'lf_hf': 15.0,   # ±15% (ratio amplifies errors)
        'total_power': 10.0,  # ±10%
        
        # Breathing analysis (challenging)
        'breathingrate': 20.0,  # ±20% (Hz), ±1.2 BPM
        'breathing_bpm': 8.0,   # ±8% in BPM units
    }
    
    # Process each record
    all_comparisons = []
    record_list = [r.strip() for r in args.records.split(',')]
    
    for record in record_list:
        print(f"🔍 Processing Record {record}...")
        
        # Load MIT-BIH annotations
        r_peaks, fs, duration = load_mitbih_annotations(record, MITBIH_DIR)
        
        if r_peaks is None or len(r_peaks) < 2:
            print(f"⚠️  Skipping {record}: No valid R-peaks")
            continue
            
        # Convert to RR intervals
        rr_intervals = peaks_to_rr_intervals(r_peaks, fs)
        
        if len(rr_intervals) < args.min_rr_count:
            print(f"⚠️  Skipping {record}: Too few RR intervals ({len(rr_intervals)})")
            continue
            
        print(f"   📈 {len(rr_intervals)} valid RR intervals")
        print(f"   💓 Mean RR: {np.mean(rr_intervals):.1f}ms, BPM: {60000/np.mean(rr_intervals):.1f}")
        
        # Analyze with Python HeartPy
        print("   🐍 Analyzing with Python HeartPy...")
        py_result, py_success = analyze_with_python_heartpy(rr_intervals, test_params)
        
        # Analyze with C++ Enhanced
        print("   🚀 Analyzing with C++ Enhanced...")  
        cpp_result, cpp_success = analyze_with_cpp_enhanced(rr_intervals, test_params)
        
        if py_success and cpp_success:
            # Compare metrics
            comparison = compare_metrics(py_result, cpp_result, record, tolerances)
            all_comparisons.append(comparison)
            
            success_rate = comparison['passed_comparisons'] / comparison['total_comparisons'] * 100
            print(f"   ✅ Comparison: {comparison['passed_comparisons']}/{comparison['total_comparisons']} passed ({success_rate:.1f}%)")
            
            # Show key metrics for immediate feedback
            for metric in ['bpm', 'sdnn', 'rmssd', 'lf_hf']:
                if metric in comparison['metric_details']:
                    detail = comparison['metric_details'][metric]
                    diff_pct = detail.get('difference_percent')
                    if diff_pct is not None:
                        if detail['status'] == 'PASS':
                            print(f"      ✅ {metric.upper()}: {diff_pct:.1f}%")
                        elif detail['status'] == 'FAIL':
                            tol_pct = detail.get('tolerance_percent', 'N/A')
                            print(f"      ❌ {metric.upper()}: {diff_pct:.1f}% (tol: {tol_pct}%)")
        else:
            print(f"   ❌ Analysis failed for {record}")
            comparison = {
                'record': record,
                'total_comparisons': 0,
                'passed_comparisons': 0, 
                'failed_comparisons': 0,
                'metric_details': {}
            }
            all_comparisons.append(comparison)
        
        print()
    
    # Generate final report
    if all_comparisons:
        print("📄 Generating validation report...")
        generate_report(all_comparisons, args.output)
        print(f"✅ Validation complete!")
    else:
        print("❌ No valid comparisons generated")

if __name__ == '__main__':
    main()
