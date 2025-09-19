import os
import json
import math
import argparse
import numpy as np
import time as _time
if not hasattr(_time, 'clock'):
    _time.clock = _time.perf_counter

try:
    import heartpy as hp
except Exception as e:
    raise SystemExit("Python HeartPy required for validation: pip install heartpy scipy numpy")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CPP_EXE = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')

def to_csv(path, data):
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")

def run_cpp(csv_path: str, fs: float, opts: dict) -> dict:
    args = [CPP_EXE, csv_path, str(fs), str(opts.get('thresholdScale', 0.5)), str(opts.get('refractoryMs', 250.0)),
            str(opts.get('rrSplineS', 10.0)), '1' if opts.get('rejectSegmentwise', True) else '0', str(opts.get('segMaxRejects', 3)),
            '1' if opts.get('breathingAsBpm', False) else '0', str(opts.get('welchSec', 240.0))]
    import subprocess
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)

def hp_process(signal: np.ndarray, fs: float) -> dict:
    scaled = hp.scale_data(signal)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 5.0], sample_rate=fs, order=3, filtertype='bandpass')
    wd, m = hp.process(filtered, sample_rate=fs, report_time=True, calc_freq=True)
    def _to_ratio(x):
        try:
            xv = float(x)
            return xv/100.0 if xv > 1.0 else xv
        except Exception:
            return x
    out = {
        'bpm': float(m.get('bpm', np.nan)),
        'sdnn': float(m.get('sdnn', np.nan)),
        'rmssd': float(m.get('rmssd', np.nan)),
        'pnn50': _to_ratio(m.get('pnn50', np.nan)),
        'pnn20': _to_ratio(m.get('pnn20', np.nan)),
        'vlf': float(m.get('vlf', np.nan)) if not isinstance(m.get('vlf'), dict) else np.nan,
        'lf': float(m.get('lf', np.nan)) if not isinstance(m.get('lf'), dict) else np.nan,
        'hf': float(m.get('hf', np.nan)) if not isinstance(m.get('hf'), dict) else np.nan,
        'lf_hf': float(m.get('lf/hf', m.get('lf_hf', np.nan))),
        'breathingrate': float(m.get('breathingrate', np.nan)),
        'n_peaks': int(len(wd.get('peaklist', [])))
    }
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True, help='Path to a CSV with one column signal')
    ap.add_argument('--fs', type=float, required=True)
    ap.add_argument('--bpm_tol', type=float, default=5.0)
    ap.add_argument('--time_tol_pct', type=float, default=2.0, help='SDNN/RMSSD allowed % diff')
    ap.add_argument('--freq_tol_pct', type=float, default=5.0, help='LF/HF allowed % diff')
    args = ap.parse_args()

    if not os.path.exists(CPP_EXE):
        raise SystemExit('C++ comparator not built. Build: cd build-mac && cmake --build . --config Release -j')

    sig = np.loadtxt(args.csv, delimiter=',').astype(float)
    hp_res = hp_process(sig, args.fs)
    cpp_res = run_cpp(args.csv, args.fs, {})

    def rel_diff(a, b):
        if any(map(lambda x: x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))), [a, b])):
            return None
        if b == 0:
            return None
        return 100.0 * (a - b) / b

    metrics = ['bpm','sdnn','rmssd','pnn20','pnn50','vlf','lf','hf','lf_hf','breathingrate','n_peaks']
    print('Metric, C++, HP, AbsDiff, RelDiff%')
    failures = []
    for k in metrics:
        a = cpp_res.get(k)
        b = hp_res.get(k)
        if isinstance(a, float) and math.isnan(a): a = None
        if isinstance(b, float) and math.isnan(b): b = None
        ad = None if (a is None or b is None) else (a - b)
        rd = rel_diff(a, b)
        print(f'{k}, {a}, {b}, {ad}, {"" if rd is None else f"{rd:.2f}"}')
        # Simple gates
        if k == 'bpm' and (a is not None and b is not None) and abs(ad) > args.bpm_tol:
            failures.append(f'BPM |Δ|>{args.bpm_tol}')
        if k in ('sdnn','rmssd','pnn20','pnn50') and rd is not None and abs(rd) > args.time_tol_pct:
            failures.append(f'{k} |%Δ|>{args.time_tol_pct}')
        if k in ('lf_hf',) and rd is not None and abs(rd) > args.freq_tol_pct:
            failures.append(f'{k} |%Δ|>{args.freq_tol_pct}')

    if failures:
        print('\nValidation FAILED:')
        for f in failures: print(' -', f)
        raise SystemExit(2)
    else:
        print('\nValidation PASSED within tolerance.')

if __name__ == '__main__':
    main()
