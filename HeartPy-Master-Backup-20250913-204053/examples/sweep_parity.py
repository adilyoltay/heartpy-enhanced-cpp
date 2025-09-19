import os
import json
import math
import ast
import re
import subprocess
import heartpy as hp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def to_csv(path, data):
    with open(path, 'w') as f:
        for v in data:
            f.write(f"{float(v)}\n")

def run_cpp(csv_path, fs, rrSplineS, rejectSeg=True):
    exe = os.path.join(ROOT, 'build-mac', 'heartpy_compare_file_json')
    args = [exe, csv_path, str(fs), '0.5', '600.0', str(rrSplineS), '1' if rejectSeg else '0', '3', '0', '240']
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr or p.stdout)
    return json.loads(p.stdout)

def process_hp(data, fs):
    scaled = hp.scale_data(data)
    filtered = hp.filter_signal(scaled, cutoff=[0.5, 5.0], sample_rate=fs, order=3, filtertype='bandpass')
    wd, m = hp.process(filtered, sample_rate=fs, report_time=True, calc_freq=True)
    return wd, m

def diff_row(cpp, wd):
    py = { 'bpm': wd.get('bpm'), 'sdnn': wd.get('sdnn'), 'rmssd': wd.get('rmssd'),
           'pnn50': wd.get('pnn50'), 'vlf': wd.get('vlf'), 'lf': wd.get('lf'), 'hf': wd.get('hf'), 'lf_hf': wd.get('lf/hf'),
           'breathingrate': wd.get('breathingrate'), 'n_peaks': len(wd.get('peaklist', [])) }
    keys = ['bpm','sdnn','rmssd','pnn50','vlf','lf','hf','lf_hf','breathingrate','n_peaks']
    out = {}
    for k in keys:
        a = cpp.get(k)
        b = py.get(k)
        if isinstance(a, float) and (math.isnan(a) or math.isinf(a)): a = None
        if isinstance(b, float) and (math.isnan(b) or math.isinf(b)): b = None
        out[k] = (a,b)
    return out

def print_report(name, rrS, report):
    print(f"\n-- {name} rrSplineS={rrS} --")
    print("Metric, C++, Python")
    for k,(a,b) in report.items():
        print(f"{k}, {a}, {b}")

def load_bidmc():
    path = os.path.join(ROOT, 'examples', 'bidmc_data.py')
    txt = open(path).read()
    m = re.search(r"full_ppg_data\s*=\s*(\[.*?\])", txt, re.S)
    if not m: raise RuntimeError('full_ppg_data not found')
    data = ast.literal_eval(m.group(1))
    fs = 125.0 if (len(data) % 20 == 0) else 100.0
    return data, fs

def load_ekg():
    path = os.path.join(ROOT, 'examples', 'ekg.py')
    txt = open(path).read()
    m = re.search(r"full_ecg_data\s*=\s*(\[.*?\])", txt, re.S)
    if not m: raise RuntimeError('full_ecg_data not found')
    data = ast.literal_eval(m.group(1))
    fs = 360.0 if (len(data) % 10 == 0) else 250.0
    return data, fs

def run_dataset(name, data, fs, rr_values):
    print(f"\n## Dataset: {name}, fs={fs}, N={len(data)}")
    wd, m = process_hp(data, fs)
    csv_path = os.path.join(ROOT, 'build-mac', f'{name}.csv')
    to_csv(csv_path, hp.scale_data(data))
    for rrS in rr_values:
        cpp = run_cpp(csv_path, fs, rrS, True)
        rep = diff_row(cpp, wd)
        print_report(name, rrS, rep)

def main():
    rr_values = [5, 10, 15]
    data_b, fs_b = load_bidmc()
    run_dataset('BIDMC', data_b, fs_b, rr_values)
    data_e, fs_e = load_ekg()
    run_dataset('EKG', data_e, fs_e, rr_values)

if __name__ == '__main__':
    main()

