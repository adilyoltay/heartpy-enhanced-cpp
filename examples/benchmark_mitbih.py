import os
import re
import json
import math
import argparse
import subprocess
from typing import List, Tuple

import numpy as np
import heartpy as hp

try:
    from scipy.io import loadmat
except Exception:
    loadmat = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CPP_EXE = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')


def _find_mat_signal_keys(d: dict) -> List[str]:
    # Common keys in PhysioNet/Matlab dumps
    candidates = ['val', 'sig', 'signal', 'data', 'ecg', 'x']
    return [k for k in candidates if k in d]


def load_record(path: str) -> Tuple[np.ndarray, float]:
    """Loads a record as (signal, fs). Supports .csv and .mat (best-effort)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == '.csv':
        arr = np.loadtxt(path, delimiter=',')
        if arr.ndim > 1:
            sig = arr[:, 0]
        else:
            sig = arr
        # Default MIT-BIH ECG fs
        return sig.astype(float), 360.0
    if ext == '.mat' and loadmat is not None:
        d = loadmat(path)
        fs = None
        for k in ['fs', 'Fs', 'SampFreq', 'sample_rate']:
            if k in d:
                try:
                    fs = float(np.squeeze(d[k]))
                    break
                except Exception:
                    pass
        keys = _find_mat_signal_keys(d)
        if not keys:
            raise RuntimeError(f'No signal key found in {path}')
        sig = np.asarray(d[keys[0]]).astype(float)
        if sig.ndim == 2:
            # pick first channel if (nch, n) or (n, nch)
            if sig.shape[0] < sig.shape[1]:
                sig = sig[0, :]
            else:
                sig = sig[:, 0]
        sig = np.squeeze(sig)
        if fs is None:
            fs = 360.0
        return sig, float(fs)
    raise RuntimeError(f'Unsupported file type or SciPy not available: {path}')


def to_csv(path: str, data: np.ndarray) -> None:
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")


def run_cpp(csv_path: str, fs: float, rr_spline_s: float = 10.0, reject_seg: bool = True,
            seg_max_rejects: int = 3, breathing_as_bpm: bool = False, welch_sec: float = 240.0) -> dict:
    args = [CPP_EXE, csv_path, str(fs), '0.5', '600.0', str(rr_spline_s),
            '1' if reject_seg else '0', str(seg_max_rejects), '1' if breathing_as_bpm else '0', str(welch_sec)]
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)


def hp_process(signal: np.ndarray, fs: float) -> dict:
    # ECG için geniş bandpass; HP’nin process içinde rolling mean/fit_peaks akışı çalışır
    scaled = hp.scale_data(signal)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 40.0], sample_rate=fs, order=3, filtertype='bandpass')
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
    ap.add_argument('--root', default=os.path.join(ROOT, 'examples', 'mit-bih-arrhythmia-database-1.0.0'))
    ap.add_argument('--limit', type=int, default=5)
    ap.add_argument('--rrSplineS', type=float, default=10.0)
    ap.add_argument('--rejectSegmentwise', action='store_true', default=True)
    ap.add_argument('--segMaxRejects', type=int, default=3)
    ap.add_argument('--breathingAsBpm', action='store_true', default=False)
    ap.add_argument('--welchSec', type=float, default=240.0)
    args = ap.parse_args()

    if not os.path.exists(CPP_EXE):
        raise SystemExit('C++ comparator not built. Build: cd build-mac && cmake --build . --config Release -j')

    files = []
    for root, _, fns in os.walk(args.root):
        for fn in fns:
            if fn.lower().endswith(('.csv', '.mat')):
                files.append(os.path.join(root, fn))
    files.sort()
    if args.limit:
        files = files[:args.limit]

    print(f"Found {len(files)} files under {args.root}")
    # Accumulators for summary
    metrics = ['bpm','sdnn','rmssd','pnn50','vlf','lf','hf','lf_hf','breathingrate','n_peaks']
    diffs_abs = {k: [] for k in metrics}
    diffs_rel = {k: [] for k in metrics}
    for fp in files:
        try:
            sig, fs = load_record(fp)
            hp_res = hp_process(sig, fs)
            csv_tmp = os.path.join(ROOT, 'build-mac', 'tmp_signal.csv')
            to_csv(csv_tmp, hp.scale_data(sig))
            cpp_res = run_cpp(csv_tmp, fs, args.rrSplineS, args.rejectSegmentwise, args.segMaxRejects, args.breathingAsBpm, args.welchSec)
            print(f"\nRecord: {os.path.relpath(fp, args.root)} (fs={fs}, N={len(sig)})")
            print("Metric, C++, HP")
            for k in metrics:
                a = cpp_res.get(k)
                b = hp_res.get(k)
                print(f"{k}, {a}, {b}")
                if isinstance(a, (int,float)) and isinstance(b, (int,float)) and not (math.isnan(a) or math.isnan(b)):
                    diffs_abs[k].append(a - b)
                    if b != 0:
                        diffs_rel[k].append(100.0 * (a - b) / b)
        except Exception as e:
            print(f"Error on {fp}: {e}")

    # Summary
    def _safe_stats(vals):
        if not vals: return (None, None)
        arr = np.array(vals)
        return (float(np.nanmean(arr)), float(np.nanmedian(arr)))

    print("\n==== Summary (C++ - HP) ====")
    print("Metric, MeanAbsDiff, MedianAbsDiff, MeanRelDiff%, MedianRelDiff%")
    for k in metrics:
        mean_abs, med_abs = _safe_stats(diffs_abs[k])
        mean_rel, med_rel = _safe_stats(diffs_rel[k])
        print(f"{k}, {mean_abs}, {med_abs}, {mean_rel}, {med_rel}")


if __name__ == '__main__':
    main()
