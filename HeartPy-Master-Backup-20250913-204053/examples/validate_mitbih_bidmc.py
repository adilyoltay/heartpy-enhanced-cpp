import os
import json
import math
import argparse
from typing import Dict, List, Tuple

import numpy as np
import time as _time
if not hasattr(_time, 'clock'):
    _time.clock = _time.perf_counter  # HeartPy compatibility for newer Python
import heartpy as hp

try:
    import wfdb
except Exception:
    wfdb = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CPP_EXE = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')


def to_csv(path: str, data: np.ndarray) -> None:
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")


def run_cpp(csv_path: str, fs: float, rr_spline_s: float = 10.0, reject_seg: bool = True,
            seg_max_rejects: int = 3, breathing_as_bpm: bool = False, welch_sec: float = 240.0) -> dict:
    import subprocess
    args = [CPP_EXE, csv_path, str(fs), '0.5', '600.0', str(rr_spline_s),
            '1' if reject_seg else '0', str(seg_max_rejects), '1' if breathing_as_bpm else '0', str(welch_sec)]
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)


def hp_process(signal: np.ndarray, fs: float, bpmmin: int = 30, bpmmax: int = 240) -> dict:
    fs_i = int(round(fs))
    scaled = hp.scale_data(signal)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 40.0], sample_rate=fs_i, order=3, filtertype='bandpass')
    wd, m = hp.process(filtered, sample_rate=fs_i, report_time=True, calc_freq=True, bpmmin=bpmmin, bpmmax=bpmmax)

    def _to_ratio(x):
        try:
            xv = float(x)
            return xv/100.0 if xv > 1.0 else xv
        except Exception:
            return x

    return {
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


def rel_diff(a, b):
    if any(map(lambda x: x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))), [a, b])):
        return None
    if b == 0:
        return None
    return 100.0 * (a - b) / b


def validate_record(sig: np.ndarray, fs: float, tmp_csv: str, bpmmin: int = 30, bpmmax: int = 240) -> Tuple[dict, dict]:
    hp_res = hp_process(sig, fs, bpmmin=bpmmin, bpmmax=bpmmax)
    to_csv(tmp_csv, hp.scale_data(sig))
    cpp_res = run_cpp(tmp_csv, fs)
    return cpp_res, hp_res


def summarize_results(rows: List[Tuple[str, Dict, Dict]], args):
    metrics_abs = {
        'bpm': args.bpm_tol,
    }
    metrics_pct = {
        'sdnn': args.time_tol_pct,
        'rmssd': args.time_tol_pct,
        'pnn20': args.time_tol_pct,
        'pnn50': args.time_tol_pct,
        'vlf': args.vlf_lf_hf_tol_pct,
        'lf': args.vlf_lf_hf_tol_pct,
        'hf': args.vlf_lf_hf_tol_pct,
        'lf_hf': args.lfhf_tol_pct,
    }
    breath_tol_hz = args.breathing_tol_hz
    failures = []
    for rec, cpp, hp_res in rows:
        # absolute
        for k, tol in metrics_abs.items():
            a = cpp.get(k); b = hp_res.get(k)
            if None in (a, b) or (isinstance(a, float) and math.isnan(a)) or (isinstance(b, float) and math.isnan(b)):
                continue
            if abs(a - b) > tol:
                failures.append((rec, k, a, b, f'|Δ|>{tol}'))
        # percent
        for k, tol in metrics_pct.items():
            a = cpp.get(k); b = hp_res.get(k)
            rd = rel_diff(a, b)
            if rd is None: continue
            if abs(rd) > tol:
                failures.append((rec, k, a, b, f'|%Δ|>{tol}'))
        # breathing rate in Hz
        a = cpp.get('breathingrate'); b = hp_res.get('breathingrate')
        if not (a is None or b is None or any(map(lambda x: isinstance(x, float) and (math.isnan(x) or math.isinf(x)), [a,b]))):
            if abs(a - b) > breath_tol_hz:
                failures.append((rec, 'breathingrate', a, b, f'|Δ|>{breath_tol_hz}Hz'))

    ok = (len(failures) == 0)
    return ok, failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mitbih_root', default=os.path.join(ROOT, 'examples', 'mit-bih-arrhythmia-database-1.0.0'))
    ap.add_argument('--mitbih_limit', type=int, default=5)
    ap.add_argument('--bpm_tol', type=float, default=5.0)
    ap.add_argument('--time_tol_pct', type=float, default=2.0)
    ap.add_argument('--vlf_lf_hf_tol_pct', type=float, default=2.0)
    ap.add_argument('--lfhf_tol_pct', type=float, default=5.0)
    ap.add_argument('--breathing_tol_hz', type=float, default=0.02)
    ap.add_argument('--segment_sec', type=float, default=20.0)
    ap.add_argument('--bpmmin', type=int, default=30)
    ap.add_argument('--bpmmax', type=int, default=240)
    args = ap.parse_args()

    if not os.path.exists(CPP_EXE):
        raise SystemExit('C++ comparator not built. Build: cd build-mac && cmake --build . --config Release -j')

    rows = []
    tmp_csv = os.path.join(ROOT, 'build-mac', 'tmp_validate.csv')
    os.makedirs(os.path.dirname(tmp_csv), exist_ok=True)

    # MIT-BIH (WFDB)
    picked = 0
    if wfdb is not None and os.path.isdir(args.mitbih_root):
        for fn in sorted(os.listdir(args.mitbih_root)):
            if not fn.endswith('.dat'):
                continue
            rec = os.path.splitext(fn)[0]
            try:
                record_path = os.path.join(args.mitbih_root, rec)
                sig, fields = wfdb.rdsamp(record_path)
                # pick first channel and take a front segment
                s = sig[:, 0].astype(float)
                fs = float(fields.get('fs', 360.0))
                if args.segment_sec and args.segment_sec > 0:
                    n = int(round(fs * args.segment_sec))
                    s = s[:n]
                cpp, hp_res = validate_record(s, fs, tmp_csv, bpmmin=args.bpmmin, bpmmax=args.bpmmax)
                rows.append((rec, cpp, hp_res))
                picked += 1
                if args.mitbih_limit and picked >= args.mitbih_limit:
                    break
            except Exception as e:
                print('MITBIH error', rec, e)

    ok, failures = summarize_results(rows, args)
    print('\n==== Validation Report (MIT-BIH subset) ====')
    print(f'Total records: {len(rows)}, Failures: {len(failures)}')
    if failures:
        print('Record, Metric, C++, HP, Reason')
        for rec, k, a, b, why in failures:
            print(f'{rec}, {k}, {a}, {b}, {why}')
    else:
        print('All checks within tolerance.')

    # BIDMC single PPG sample embedded in repo
    try:
        import ast, re
        with open(os.path.join(ROOT, 'examples', 'bidmc_data.py'), 'r') as f:
            txt = f.read()
        m = re.search(r"full_ppg_data\s*=\s*(\[.*?\])", txt, re.S)
        if m:
            ppg = np.array(ast.literal_eval(m.group(1)), dtype=float)
            # infer fs: stated in file comment 20s, 2500 points -> 125 Hz
            fs = 125.0 if (len(ppg) % 20 == 0) else 100.0
            cpp, hp_res = validate_record(ppg, fs, tmp_csv)
            rows2 = [("BIDMC_PPG", cpp, hp_res)]
            ok2, failures2 = summarize_results(rows2, args)
            print('\n==== Validation Report (BIDMC sample) ====')
            print(f'Failures: {len(failures2)}')
            if failures2:
                print('Record, Metric, C++, HP, Reason')
                for rec, k, a, b, why in failures2:
                    print(f'{rec}, {k}, {a}, {b}, {why}')
            else:
                print('All checks within tolerance.')
    except Exception as e:
        print('BIDMC validation error:', e)

if __name__ == '__main__':
    main()
