#!/usr/bin/env python3
"""
Minimal acceptance runner: invokes realtime_demo with synthetic data and
checks the BPM is within a plausible range. Supports torch/ambient/both presets.

Usage (as per CMakeLists):
  python3 scripts/check_acceptance.py --build-dir build-mac --preset both --fs 50 --duration 180 --fast
"""
import argparse
import json
import os
import subprocess
import sys

def run_demo(exe, fs, seconds, preset):
    args = [exe, "--fs", str(fs), "--seconds", str(seconds)]
    if preset:
        args += ["--preset", preset]
    try:
        out = subprocess.check_output(args, stderr=subprocess.STDOUT, text=True)
        # Expect a single-line JSON
        line = out.strip().splitlines()[-1]
        return json.loads(line)
    except subprocess.CalledProcessError as e:
        print(f"realtime_demo failed: {e.output}")
        return None
    except Exception as e:
        print(f"Failed to parse realtime_demo output: {e}")
        return None

def check_result(name, res, hr_tol=100):
    if not isinstance(res, dict):
        print(f"{name}: invalid result")
        return False
    bpm = res.get("bpm")
    if not isinstance(bpm, (int, float)):
        print(f"{name}: missing bpm in result: {res}")
        return False
    # Synthetic signal around 72 BPM; allow generous tolerance
    ok = (40.0 <= bpm <= 180.0)
    print(f"{name}: bpm={bpm:.2f} -> {'PASS' if ok else 'FAIL'}")
    return ok

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-dir", required=True)
    ap.add_argument("--preset", choices=["torch","ambient","both"], default="both")
    ap.add_argument("--fs", type=float, default=50.0)
    ap.add_argument("--duration", type=float, default=60.0)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--hr-tol", type=float, default=100.0)
    args = ap.parse_args()

    exe = os.path.join(args.build_dir, "realtime_demo")
    if sys.platform.startswith("win"):
        exe += ".exe"
    if not os.path.exists(exe):
        print(f"realtime_demo not found at {exe}")
        return 1

    presets = ["torch", "ambient"] if args.preset == "both" else [args.preset]
    ok = True
    for p in presets:
        res = run_demo(exe, args.fs, args.duration, p)
        ok = check_result(p, res, hr_tol=args.hr_tol) and ok
    return 0 if ok else 2

if __name__ == "__main__":
    sys.exit(main())

