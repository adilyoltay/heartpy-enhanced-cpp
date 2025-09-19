import os
import json
import math
import subprocess
import numpy as np
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def generate_realistic(sample_rate=100.0, duration=180.0):
    np.random.seed(42)
    num = int(sample_rate * duration)
    t = np.linspace(0, duration, num, endpoint=False)
    base = 70
    hrv_slow = 5 * np.sin(2*np.pi*0.01*t)
    hrv_fast = np.random.normal(0, 0.5, num)
    hr_bpm = base + hrv_slow + hrv_fast
    freq = hr_bpm / 60.0
    phase = np.cumsum(2*np.pi*freq / sample_rate)
    sig = np.cos(phase) * 1.0 + np.cos(phase*2 - np.pi/4) * 0.3
    baseline = 0.15 * np.sin(2*np.pi*0.1*t)
    noise = np.random.normal(0, 0.05, num)
    return (sig + baseline + noise).tolist()

def save_csv(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")

def run_py(data, fs):
    wd, m = hp.process(data, sample_rate=fs, report_time=True, calc_freq=True)
    return {
        'bpm': float(m['bpm']),
        'sdnn': float(m['sdnn']),
        'rmssd': float(m['rmssd']),
        'n_peaks': len(wd.get('peaklist', []))
    }

def run_cpp(csv_path, fs, ts, refr):
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
    w_bpm, w_sdnn, w_rmssd, w_peaks = 1.0, 1.0, 1.0, 0.5
    return (w_bpm*rel(cpp['bpm'], py['bpm']) +
            w_sdnn*rel(cpp['sdnn'], py['sdnn']) +
            w_rmssd*rel(cpp['rmssd'], py['rmssd']) +
            w_peaks*rel(cpp['n_peaks'], py['n_peaks']))

def main():
    fs = 100.0
    data = generate_realistic(fs)
    csv_path = os.path.join(ROOT, 'build-mac', 'sweep_data.csv')
    save_csv(csv_path, data)
    py = run_py(data, fs)

    best = None
    best_cfg = None
    for ts in np.linspace(0.3, 1.2, 10):
        for refr in range(300, 751, 50):
            cpp = run_cpp(csv_path, fs, ts, refr)
            L = loss(cpp, py)
            if (best is None) or (L < best):
                best = L
                best_cfg = (ts, refr, cpp)
    ts, refr, cpp = best_cfg
    print('Python:', json.dumps(py, indent=2))
    print('C++ best:', json.dumps(cpp, indent=2))
    print(f'Best params -> thresholdScale={ts:.3f}, refractoryMs={refr}, loss={best:.4f}')

if __name__ == '__main__':
    main()

