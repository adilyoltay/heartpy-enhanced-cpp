import os
import json
import math
import ast
import re
import subprocess
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def parse_bidmc():
    path = os.path.join(ROOT, 'examples', 'bidmc_data.py')
    with open(path, 'r') as f:
        txt = f.read()
    m = re.search(r"full_ppg_data\s*=\s*(\[.*?\])", txt, re.S)
    if not m:
        raise RuntimeError('full_ppg_data list not found')
    data = ast.literal_eval(m.group(1))
    fs = 125.0 if (len(data) % 20 == 0) else 100.0
    return data, fs

def run_py(data, fs):
    scaled = hp.scale_data(data)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 5.0], sample_rate=fs, order=3, filtertype='bandpass')
    wd, m = hp.process(filtered, sample_rate=fs, report_time=True, calc_freq=True)
    return {'bpm': float(m['bpm']), 'sdnn': float(m['sdnn']), 'rmssd': float(m['rmssd']), 'n_peaks': len(wd.get('peaklist', []))}

def run_cpp(data, fs, ts, refr):
    csv_path = os.path.join(ROOT, 'build-mac', 'bidmc_ppg.csv')
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    with open(csv_path, 'w') as f:
        for v in hp.scale_data(data):
            f.write(f"{float(v)}\n")
    exe = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')
    p = subprocess.run([exe, csv_path, str(fs), str(ts), str(refr)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    j = json.loads(p.stdout)
    return {'bpm': j['bpm'], 'sdnn': j['sdnn'], 'rmssd': j['rmssd'], 'n_peaks': j['n_peaks']}

def loss(cpp, py):
    def rel(a, b):
        if b == 0: return abs(a)
        return abs((a - b) / b)
    return rel(cpp['bpm'], py['bpm']) + rel(cpp['sdnn'], py['sdnn']) + rel(cpp['rmssd'], py['rmssd']) + 0.5*rel(cpp['n_peaks'], py['n_peaks'])

def main():
    data, fs = parse_bidmc()
    py = run_py(data, fs)
    best = None
    best_cfg = None
    for ts in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        for refr in range(300, 801, 50):
            cpp = run_cpp(data, fs, ts, refr)
            L = loss(cpp, py)
            if (best is None) or (L < best):
                best = L; best_cfg = (ts, refr, cpp)
    ts, refr, cpp = best_cfg
    print('Python:', json.dumps(py, indent=2))
    print('C++ best:', json.dumps(cpp, indent=2))
    print(f'Best params -> thresholdScale={ts:.3f}, refractoryMs={refr}, loss={best:.4f}')

if __name__ == '__main__':
    main()

