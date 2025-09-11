#!/usr/bin/env python3
import argparse
import json
import os
import statistics as stats
import subprocess
import sys
from typing import List, Dict, Any


def run_demo(build_dir: str, preset: str, fs: float, duration: float, fast: bool) -> str:
    exe = os.path.join(build_dir, 'realtime_demo')
    if sys.platform.startswith('win'):
        exe += '.exe'
    if not os.path.isfile(exe):
        raise FileNotFoundError(f'realtime_demo not found at {exe}. Build the project first.')
    outpath = os.path.join(build_dir, f'acceptance_{preset}.jsonl')
    args = [exe, str(fs), str(duration), preset]
    if fast:
        args.append('fast')
    args += ['--json-out', outpath]
    print(f'Running: {" ".join(args)}')
    res = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print(res.stdout)
        print(res.stderr, file=sys.stderr)
        raise RuntimeError(f'realtime_demo failed with exit code {res.returncode}')
    return outpath


def load_jsonl(path: str) -> List[Dict[str, Any]]:
    out = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def median(values: List[float]) -> float:
    return stats.median(values) if values else float('nan')


def acceptance_check(rows: List[Dict[str, Any]], preset: str, warmup_sec: float,
                     hr_target: float, hr_tol: float,
                     snr_min_db: float, conf_min: float,
                     reject_max: float,
                     ma_low: float, ma_high: float, ma_share_min: float) -> Dict[str, Any]:
    after = [r for r in rows if r.get('t', 0.0) >= warmup_sec]
    if not after:
        return {'ok': False, 'reason': 'no data after warmup'}

    bpm_med = median([r.get('stream_bpm', r.get('bpm', 0.0)) for r in after])
    snr_med = median([r.get('snr_db', 0.0) for r in after])
    conf_med = median([r.get('conf', 0.0) for r in after])
    rej_med = median([r.get('rejection', 0.0) for r in after])
    ma_vals = [r.get('ma_perc', 0.0) for r in after]
    ma_share = sum(1 for m in ma_vals if ma_low <= m <= ma_high) / max(1, len(ma_vals))
    hard_frac = sum(1 for r in after if r.get('hard_dbl', 0) == 1) / max(1, len(after))
    soft_frac = sum(1 for r in after if r.get('soft_dbl', 0) == 1) / max(1, len(after))

    hr_ok = abs(bpm_med - hr_target) <= hr_tol
    snr_ok = snr_med >= snr_min_db
    conf_ok = conf_med >= conf_min
    rej_ok = rej_med <= reject_max
    ma_ok = ma_share >= ma_share_min
    flags_ok = hard_frac <= 0.05  # hard flag should not persist

    ok = all([hr_ok, snr_ok, conf_ok, rej_ok, ma_ok, flags_ok])
    return {
        'ok': ok,
        'preset': preset,
        'bpm_med': bpm_med,
        'snr_med': snr_med,
        'conf_med': conf_med,
        'rej_med': rej_med,
        'ma_share': ma_share,
        'hard_frac': hard_frac,
        'soft_frac': soft_frac,
        'checks': {
            'hr_ok': hr_ok,
            'snr_ok': snr_ok,
            'conf_ok': conf_ok,
            'rej_ok': rej_ok,
            'ma_ok': ma_ok,
            'flags_ok': flags_ok,
        }
    }


def main():
    ap = argparse.ArgumentParser(description='Acceptance checker for realtime_demo')
    ap.add_argument('--build-dir', default='build-mac', help='Build directory containing realtime_demo')
    ap.add_argument('--preset', choices=['torch', 'ambient', 'both'], default='both')
    ap.add_argument('--fs', type=float, default=50.0)
    ap.add_argument('--duration', type=float, default=180.0)
    ap.add_argument('--fast', action='store_true', default=True)
    ap.add_argument('--warmup-sec', type=float, default=20.0)
    ap.add_argument('--hr-target', type=float, default=72.0)
    ap.add_argument('--hr-tol', type=float, default=2.0)
    ap.add_argument('--snr-min-db', type=float, default=6.0)
    ap.add_argument('--conf-min', type=float, default=0.6)
    ap.add_argument('--reject-max', type=float, default=0.10)
    ap.add_argument('--ma-low', type=float, default=20.0)
    ap.add_argument('--ma-high', type=float, default=35.0)
    ap.add_argument('--ma-share-min', type=float, default=0.6)
    args = ap.parse_args()

    presets = ['torch', 'ambient'] if args.preset == 'both' else [args.preset]
    had_fail = False
    results = []
    for p in presets:
        jsonl = run_demo(args.build_dir, p, args.fs, args.duration, args.fast)
        rows = load_jsonl(jsonl)
        res = acceptance_check(rows, p, args.warmup_sec,
                               args.hr_target, args.hr_tol,
                               args.snr_min_db, args.conf_min,
                               args.reject_max,
                               args.ma_low, args.ma_high, args.ma_share_min)
        results.append(res)
        print(f"Preset={p}: ok={res['ok']} bpm_med={res['bpm_med']:.2f} snr_med={res['snr_med']:.2f} conf_med={res['conf_med']:.2f} rej_med={res['rej_med']:.3f} ma_share={res['ma_share']:.2f} hard_frac={res['hard_frac']:.2f}")
        if not res['ok']:
            had_fail = True
            print('  Failed checks:', ', '.join([k for k, v in res['checks'].items() if not v]))

    sys.exit(0 if not had_fail else 1)


if __name__ == '__main__':
    main()

