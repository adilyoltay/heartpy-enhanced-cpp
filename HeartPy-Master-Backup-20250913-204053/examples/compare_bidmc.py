import os
import json
import math
import subprocess
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def to_csv(path, data):
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")

def run_cpp(csv_path: str, fs: float, threshold_scale: float, refractory_ms: float):
    exe = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')
    p = subprocess.run([exe, csv_path, str(fs), str(threshold_scale), str(refractory_ms)], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)

def rel_diff(a, b):
    if any(map(lambda x: x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))), [a, b])):
        return None
    if b == 0:
        return None
    return 100.0 * (a - b) / b

def main():
    # Load BIDMC data safely by parsing the list literal from file
    import ast, re
    bidmc_path = os.path.join(ROOT, 'examples', 'bidmc_data.py')
    with open(bidmc_path, 'r') as f:
        txt = f.read()
    m = re.search(r"full_ppg_data\s*=\s*(\[.*?\])", txt, re.S)
    if not m:
        raise RuntimeError('full_ppg_data list not found in bidmc_data.py')
    raw = ast.literal_eval(m.group(1))
    # Assume 20 seconds, infer fs when divisible
    fs = 125.0 if (len(raw) % 20 == 0) else 100.0

    # Scale and filter for HeartPy
    scaled = hp.scale_data(raw)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 5.0], sample_rate=fs, order=3, filtertype='bandpass')
    wd, m = hp.process(filtered, sample_rate=fs, report_time=True, calc_freq=True)
    # Normalize HeartPy outputs to expected units (pNN as ratio 0..1)
    def _to_ratio(x):
        try:
            xv = float(x)
            return xv/100.0 if xv > 1.0 else xv
        except Exception:
            return x

    py = {
        'bpm': float(m.get('bpm', float('nan'))),
        'sdnn': float(m.get('sdnn', float('nan'))),
        'rmssd': float(m.get('rmssd', float('nan'))),
        'pnn50': _to_ratio(m.get('pnn50', float('nan'))),
        'pnn20': _to_ratio(m.get('pnn20', float('nan'))),
        'vlf': float(m.get('vlf', float('nan'))) if not isinstance(m.get('vlf'), dict) else float('nan'),
        'lf': float(m.get('lf', float('nan'))) if not isinstance(m.get('lf'), dict) else float('nan'),
        'hf': float(m.get('hf', float('nan'))) if not isinstance(m.get('hf'), dict) else float('nan'),
        'lf_hf': float(m.get('lf/hf', m.get('lf_hf', float('nan')))),
        'breathingrate': float(m.get('breathingrate', float('nan'))),
        'n_peaks': int(len(wd.get('peaklist', [])))
    }

    # Prepare CSV for C++ (use the same filtered signal as Python)
    csv_path = os.path.join(ROOT, 'build-mac', 'bidmc_ppg.csv')
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    to_csv(csv_path, filtered)

    # Reasonable defaults; adjust if needed (use sweep findings if desired)
    threshold_scale = 0.5
    refractory_ms = 600.0
    cpp = run_cpp(csv_path, fs, threshold_scale, refractory_ms)

    # Normalize C++ outputs: ensure pNN values are ratios (0..1) for parity
    # The C++ library can output pNN in percent depending on Options.
    # Convert defensively here for reporting consistency with Python side.
    def _to_ratio_cpp(x):
        try:
            xv = float(x)
            return xv/100.0 if xv > 1.0 else xv
        except Exception:
            return x

    if 'pnn50' in cpp:
        cpp['pnn50'] = _to_ratio_cpp(cpp['pnn50'])
    if 'pnn20' in cpp:
        cpp['pnn20'] = _to_ratio_cpp(cpp['pnn20'])

    print('Python (HeartPy):')
    print(json.dumps(py, indent=2))
    print('\nC++:')
    print(json.dumps(cpp, indent=2))

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
        print(f'{k}, {a}, {b}, {ad}, {"" if rd is None else f"{rd:.2f}"}')

if __name__ == '__main__':
    main()
