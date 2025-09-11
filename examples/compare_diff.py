import json
import math
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run_python():
    # Assumes venv is active with heartpy installed
    p = subprocess.run([sys.executable, os.path.join(ROOT, 'examples', 'compare_with_python.py')],
                       capture_output=True, text=True)
    if p.returncode != 0:
        print('Python HeartPy run failed:', p.stderr or p.stdout, file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)

def run_cpp():
    exe = os.path.join(ROOT, 'build-mac', 'heartpy_compare_json')
    p = subprocess.run([exe], capture_output=True, text=True)
    if p.returncode != 0:
        print('C++ comparator failed:', p.stderr or p.stdout, file=sys.stderr)
        sys.exit(1)
    return json.loads(p.stdout)

def rel_diff(a, b):
    if any(map(lambda x: x is None or (isinstance(x, float) and math.isnan(x)), [a, b])):
        return None
    if b == 0:
        return None
    return 100.0 * (a - b) / b

def main():
    py = run_python()
    cpp = run_cpp()

    keys = [
        'bpm', 'sdnn', 'rmssd', 'pnn50',
        'lf', 'hf', 'lf_hf', 'breathingrate', 'n_peaks'
    ]

    print('Metric, C++, Python, AbsDiff, RelDiff(%)')
    for k in keys:
        a = cpp.get(k, None)
        b = py.get(k, None)
        # Normalize NaN to None
        if isinstance(a, float) and math.isnan(a):
            a = None
        if isinstance(b, float) and math.isnan(b):
            b = None
        if a is None or b is None:
            print(f'{k}, {a}, {b}, , ')
            continue
        ad = a - b
        rd = rel_diff(a, b)
        rd_str = '' if rd is None else f'{rd:.2f}'
        print(f'{k}, {a}, {b}, {ad}, {rd_str}')

if __name__ == '__main__':
    main()

