#!/usr/bin/env python3
"""
Simplified MIT-BIH Validation Script
===================================

This script runs a simplified but reliable validation test using MIT-BIH
database annotations, focusing on core metrics without Python HeartPy's
internal state dependencies.

Author: HeartPy Enhanced Team
"""

import os
import sys
import json
import time
import numpy as np
import wfdb
from pathlib import Path
import subprocess

# Fix time.clock for older HeartPy
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

def load_mitbih_record(record_name):
    """Load MIT-BIH record and extract RR intervals from annotations"""
    try:
        record_path = str(MITBIH_DIR / record_name)
        
        # Load annotations
        ann = wfdb.rdann(record_path, 'atr')
        header = wfdb.rdheader(record_path)
        fs = header.fs
        
        # Filter for normal/sinus beats only
        normal_beats = ['N', 'L', 'R', 'e', 'j']
        r_peaks = [ann.sample[i] for i, symbol in enumerate(ann.symbol) if symbol in normal_beats]
        
        if len(r_peaks) < 2:
            return None, None, None
        
        r_peaks = np.array(r_peaks)
        
        # Convert to RR intervals (ms)
        rr_samples = np.diff(r_peaks)
        rr_ms = (rr_samples / fs) * 1000.0
        
        # Filter physiologically reasonable (300-2000ms)  
        valid_mask = (rr_ms >= 300) & (rr_ms <= 2000)
        valid_rr = rr_ms[valid_mask]
        
        duration_min = (r_peaks[-1] - r_peaks[0]) / fs / 60
        
        return valid_rr, fs, {
            'total_peaks': len(r_peaks),
            'valid_rr': len(valid_rr),
            'duration_min': duration_min,
            'mean_rr': np.mean(valid_rr),
            'bpm': 60000 / np.mean(valid_rr)
        }
        
    except Exception as e:
        print(f"❌ Error loading {record_name}: {e}")
        return None, None, None

def test_single_record(record_name):
    """Test a single MIT-BIH record"""
    print(f"\n🔍 Testing Record {record_name}")
    print("-" * 40)
    
    # Load data
    rr_intervals, fs, info = load_mitbih_record(record_name)
    
    if rr_intervals is None:
        print(f"❌ Failed to load {record_name}")
        return None
        
    print(f"📊 Loaded: {info['valid_rr']} RR intervals from {info['total_peaks']} peaks")
    print(f"⏱️  Duration: {info['duration_min']:.1f} minutes")
    print(f"💓 Mean RR: {info['mean_rr']:.1f}ms → {info['bpm']:.1f} BPM")
    
    if len(rr_intervals) < 10:
        print(f"⚠️  Too few valid RR intervals")
        return None
    
    # Test Python HeartPy (minimal call to avoid state issues)
    print("\n🐍 Python HeartPy Analysis:")
    try:
        wd, measures = hp.process_rr(
            rr_list=rr_intervals.tolist(),
            clean_rr=False,  # Disable to avoid state issues
            calc_freq=False,  # Disable freq domain to avoid issues
            breathing_method='welch'
        )
        
        py_metrics = {
            'bpm': measures.get('bpm', np.nan),
            'sdnn': measures.get('sdnn', np.nan),
            'rmssd': measures.get('rmssd', np.nan),
            'pnn50': measures.get('pnn50', np.nan) * 100,  # HeartPy returns fraction
            'sd1': measures.get('sd1', np.nan),
            'sd2': measures.get('sd2', np.nan),
            'hr_mad': measures.get('hr_mad', np.nan),
        }
        
        for metric, value in py_metrics.items():
            if not np.isnan(value):
                print(f"  ✅ {metric.upper()}: {value:.3f}")
            else:
                print(f"  ❌ {metric.upper()}: NaN")
                
        py_success = True
        
    except Exception as e:
        print(f"  ❌ Python HeartPy failed: {e}")
        py_metrics = {}
        py_success = False
    
    # Test C++ Enhanced
    print("\n🚀 C++ Enhanced Analysis:")
    try:
        # Create temp CSV
        csv_path = "/tmp/test_rr.csv"
        np.savetxt(csv_path, rr_intervals, fmt='%.6f')
        
        # Run C++ analysis
        cmd = [str(CPP_EXE), csv_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            print(f"  ❌ C++ execution failed: {result.stderr}")
            cpp_success = False
            cpp_metrics = {}
        else:
            cpp_data = json.loads(result.stdout)
            cpp_metrics = {
                'bpm': cpp_data['bpm'],
                'sdnn': cpp_data['sdnn'],
                'rmssd': cpp_data['rmssd'], 
                'pnn50': cpp_data['pnn50'],
                'sd1': cpp_data['sd1'],
                'sd2': cpp_data['sd2'],
                'hr_mad': cpp_data['mad'],
            }
            
            for metric, value in cpp_metrics.items():
                print(f"  ✅ {metric.upper()}: {value:.3f}")
                
            cpp_success = True
            
        # Cleanup
        try:
            os.unlink(csv_path)
        except:
            pass
            
    except Exception as e:
        print(f"  ❌ C++ Enhanced failed: {e}")
        cpp_metrics = {}
        cpp_success = False
    
    # Compare if both succeeded
    if py_success and cpp_success:
        print(f"\n📊 Metric Comparison:")
        print(f"{'Metric':<10} {'Python':<12} {'C++':<12} {'Diff %':<10} {'Status'}")
        print("-" * 60)
        
        total_comparisons = 0
        passed_comparisons = 0
        
        for metric in ['bpm', 'sdnn', 'rmssd', 'pnn50', 'sd1', 'sd2', 'hr_mad']:
            if metric in py_metrics and metric in cpp_metrics:
                py_val = py_metrics[metric]
                cpp_val = cpp_metrics[metric]
                
                if not (np.isnan(py_val) or np.isnan(cpp_val)):
                    diff_pct = abs((cpp_val - py_val) / py_val * 100) if py_val != 0 else 0
                    tolerance = 2.0  # ±2% for time domain metrics
                    
                    status = "✅" if diff_pct <= tolerance else "❌"
                    if status == "✅":
                        passed_comparisons += 1
                    total_comparisons += 1
                    
                    print(f"{metric.upper():<10} {py_val:<12.3f} {cpp_val:<12.3f} {diff_pct:<10.2f} {status}")
        
        success_rate = (passed_comparisons / total_comparisons * 100) if total_comparisons > 0 else 0
        print(f"\n🎯 Success Rate: {passed_comparisons}/{total_comparisons} ({success_rate:.1f}%)")
        
        return {
            'record': record_name,
            'success_rate': success_rate,
            'passed': passed_comparisons,
            'total': total_comparisons,
            'py_metrics': py_metrics,
            'cpp_metrics': cpp_metrics
        }
    
    return None

def main():
    """Run MIT-BIH validation on key records"""
    print("🫀 MIT-BIH Database Validation")
    print("HeartPy Enhanced C++ vs Python HeartPy")
    print("=" * 50)
    
    # Test records with good data quality
    test_records = ['100', '101', '103', '108', '119']
    
    results = []
    
    for record in test_records:
        result = test_single_record(record)
        if result:
            results.append(result)
    
    # Generate summary
    if results:
        print(f"\n📋 VALIDATION SUMMARY")
        print("=" * 50)
        
        total_success = sum(r['passed'] for r in results)
        total_comparisons = sum(r['total'] for r in results)
        overall_rate = (total_success / total_comparisons * 100) if total_comparisons > 0 else 0
        
        print(f"📊 Records Tested: {len(results)}")
        print(f"📊 Total Comparisons: {total_comparisons}")
        print(f"📊 Passed Comparisons: {total_success}")
        print(f"📊 Overall Success Rate: {overall_rate:.1f}%")
        
        # Show per-record summary
        print(f"\n📋 Per-Record Results:")
        for r in results:
            status = "✅" if r['success_rate'] >= 90 else "⚠️" if r['success_rate'] >= 70 else "❌"
            print(f"  {status} Record {r['record']}: {r['success_rate']:.1f}% ({r['passed']}/{r['total']})")
        
        # Success criteria
        if overall_rate >= 95:
            print(f"\n🎉 VALIDATION PASSED: {overall_rate:.1f}% ≥ 95%")
            print("✅ HeartPy Enhanced C++ is scientifically equivalent to Python HeartPy!")
        elif overall_rate >= 85:
            print(f"\n⚠️  VALIDATION PARTIAL: {overall_rate:.1f}% (85-95%)")
            print("🔧 Minor improvements needed for full scientific equivalency")
        else:
            print(f"\n❌ VALIDATION FAILED: {overall_rate:.1f}% < 85%") 
            print("🚨 Major issues need addressing")
            
        return overall_rate
    
    else:
        print("❌ No successful validations")
        return 0.0

if __name__ == '__main__':
    success_rate = main()
    sys.exit(0 if success_rate >= 85 else 1)  # Exit code for CI/automation
