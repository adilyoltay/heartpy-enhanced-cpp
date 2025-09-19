import os
import json
import math
import subprocess
import numpy as np
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def generate_realistic_ppg_ecg_data(sample_rate: float = 100.0, duration: float = 180.0):
    np.random.seed(42)
    num_samples = int(duration * sample_rate)
    time = np.linspace(0, duration, num_samples, endpoint=False)
    base_hr_bpm = 70
    hr_variation_slow = 5 * np.sin(2 * np.pi * 0.01 * time)
    hr_variation_fast = np.random.normal(0, 0.5, num_samples)
    instantaneous_hr_bpm = base_hr_bpm + hr_variation_slow + hr_variation_fast
    instantaneous_freq_hz = instantaneous_hr_bpm / 60.0
    phase = np.cumsum(2 * np.pi * instantaneous_freq_hz / sample_rate)
    signal = np.cos(phase) * 1.0 + np.cos(phase * 2 - np.pi / 4) * 0.3
    baseline_wander = 0.15 * np.sin(2 * np.pi * 0.1 * time)
    noise = np.random.normal(0, 0.05, num_samples)
    realistic_data = signal + baseline_wander + noise
    return realistic_data.tolist()

def save_csv(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")

def run_cpp(csv_path: str, fs: float, threshold_scale: float = 0.5, refractory_ms: float = 250.0):
    exe = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')
    p = subprocess.run([exe, csv_path, str(fs), str(threshold_scale), str(refractory_ms)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)

def run_python(data, fs: float):
    wd, m = hp.process(data, sample_rate=fs, report_time=True, calc_freq=True)
    def get(mv, k, alt=None):
        if k in mv: return mv[k]
        if alt is not None and alt in mv: return mv[alt]
        return float('nan')
    br_hz = float(get(m, 'breathingrate'))
    br_bpm = (br_hz * 60.0) if (not math.isnan(br_hz)) else float('nan')
    return {
        'bpm': float(get(m, 'bpm')),
        'sdnn': float(get(m, 'sdnn')),
        'rmssd': float(get(m, 'rmssd')),
        'pnn50': float(get(m, 'pnn50')),
        'vlf': float(get(m, 'vlf')) if not isinstance(get(m, 'vlf'), dict) else float('nan'),
        'lf': float(get(m, 'lf')) if not isinstance(get(m, 'lf'), dict) else float('nan'),
        'hf': float(get(m, 'hf')) if not isinstance(get(m, 'hf'), dict) else float('nan'),
        'lf_hf': float(get(m, 'lf/hf', 'lf_hf')),
        'breathingrate': br_bpm,
        'n_peaks': int(len(wd.get('peaklist', [])))
    }

def main():
    fs = 100.0
    data = generate_realistic_ppg_ecg_data()
    csv_path = os.path.join(ROOT, 'build-mac', 'synthetic_ppg_ecg_data_3min.csv')
    save_csv(csv_path, data)

    py = run_python(data, fs)
    cpp = run_cpp(csv_path, fs, threshold_scale=0.5, refractory_ms=600.0)

    print('Python (HeartPy):')
    print(json.dumps(py, indent=2))
    print('\nC++:')
    print(json.dumps(cpp, indent=2))

    def rel_diff(a, b):
        if any(map(lambda x: x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))), [a, b])):
            return None
        if b == 0:
            return None
        return 100.0 * (a - b) / b

    keys = ['bpm','sdnn','rmssd','pnn50','vlf','lf','hf','lf_hf','breathingrate','n_peaks']
    print('\nMetric, C++, Python, AbsDiff, RelDiff(%)')
    for k in keys:
        a = cpp.get(k)
        b = py.get(k)
        if isinstance(a, float) and math.isnan(a): a = None
        if isinstance(b, float) and math.isnan(b): b = None
        if a is None or b is None:
            print(f'{k}, {a}, {b}, , ')
            continue
        ad = a - b
        rd = rel_diff(a, b)
        rd_str = '' if rd is None else f'{rd:.2f}'
        print(f'{k}, {a}, {b}, {ad}, {rd_str}')

if __name__ == '__main__':
    main()
