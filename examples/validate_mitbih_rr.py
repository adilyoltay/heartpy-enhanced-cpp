import os
import json
import math
import argparse
from typing import List, Tuple

import numpy as np
import wfdb
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CPP_RR = os.path.join(ROOT, 'build-mac', 'heartpy_compare_rr_json')


def to_csv(path: str, data: np.ndarray) -> None:
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")


def extract_rr_ms_from_ann(record_path: str) -> Tuple[np.ndarray, float]:
    sig, fields = wfdb.rdsamp(record_path)
    fs = float(fields.get('fs', 360.0))
    ann = wfdb.rdann(record_path, 'atr')
    qrs = np.array(ann.sample, dtype=int)
    if qrs.size < 2:
        return np.array([]), fs
    rr_samples = np.diff(qrs)
    rr_ms = (rr_samples / fs) * 1000.0
    return rr_ms.astype(float), fs


def run_cpp_rr(csv_path: str) -> dict:
    import subprocess
    p = subprocess.run([CPP_RR, csv_path, '1', '0'], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)


def hp_process_rr(rr_ms: np.ndarray) -> dict:
    wd, m = hp.heartpy.process_rr(rr_ms, threshold_rr=True, clean_rr=True, calc_freq=False)
    out = {
        'bpm': float(m.get('bpm', np.nan)),
        'sdnn': float(m.get('sdnn', np.nan)),
        'rmssd': float(m.get('rmssd', np.nan)),
        'sdsd': float(m.get('sdsd', np.nan)),
        'pnn20': float(m.get('pnn20', np.nan)),
        'pnn50': float(m.get('pnn50', np.nan)),
        'sd1': float(m.get('sd1', np.nan)),
        'sd2': float(m.get('sd2', np.nan)),
        'sd1sd2Ratio': float(m.get('sd1/sd2', np.nan)),
        'mad': float(m.get('mad', np.nan)) if 'mad' in m else np.nan,
    }
    return out


def rel_diff(a, b):
    if any(map(lambda x: x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))), [a, b])):
        return None
    if b == 0:
        return None
    return 100.0 * (a - b) / b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mitbih_root', default=os.path.join(ROOT, 'examples', 'mit-bih-arrhythmia-database-1.0.0'))
    ap.add_argument('--limit', type=int, default=5)
    args = ap.parse_args()

    if not os.path.exists(CPP_RR):
        raise SystemExit('C++ RR comparator not built. Build: cmake -S . -B build-mac && cmake --build build-mac -j')

    tmp_rr = os.path.join(ROOT, 'build-mac', 'tmp_rr.csv')
    os.makedirs(os.path.dirname(tmp_rr), exist_ok=True)

    rows: List[Tuple[str, dict, dict]] = []
    picked = 0
    for fn in sorted(os.listdir(args.mitbih_root)):
        if not fn.endswith('.atr'):
            continue
        rec = os.path.splitext(fn)[0]
        try:
            rr_ms, fs = extract_rr_ms_from_ann(os.path.join(args.mitbih_root, rec))
            if rr_ms.size < 5:
                continue
            to_csv(tmp_rr, rr_ms)
            cpp = run_cpp_rr(tmp_rr)
            hp_res = hp_process_rr(rr_ms)
            rows.append((rec, cpp, hp_res))
            picked += 1
            if args.limit and picked >= args.limit:
                break
        except Exception as e:
            print('RR validation error', rec, e)

    # summary
    keys_abs = ['bpm']
    keys_pct = ['sdnn','rmssd','sdsd','pnn20','pnn50','sd1','sd2','sd1sd2Ratio']
    print('Record, Metric, C++, HP, AbsDiff, RelDiff%')
    for rec, cpp, hp_res in rows:
        for k in keys_abs:
            a, b = cpp.get(k), hp_res.get(k)
            if None in (a, b) or (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
                continue
            ad = a - b
            print(f'{rec},{k},{a},{b},{ad},')
        for k in keys_pct:
            a, b = cpp.get(k), hp_res.get(k)
            rd = rel_diff(a, b)
            print(f'{rec},{k},{a},{b},,{"" if rd is None else f"{rd:.2f}"}')

    print(f"\nValidated {len(rows)} records with RR‑based parity check.")

if __name__ == '__main__':
    main()
