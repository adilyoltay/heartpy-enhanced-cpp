export type HeartPyOptions = {
	// Filtering options
	bandpass?: { lowHz: number; highHz: number; order?: number };
	welch?: { nfft?: number; overlap?: number; wsizeSec?: number };
	peak?: { refractoryMs?: number; thresholdScale?: number; bpmMin?: number; bpmMax?: number };
	
	// Preprocessing options
	preprocessing?: {
		interpClipping?: boolean;
		clippingThreshold?: number;
		hampelCorrect?: boolean;
		hampelWindow?: number;
		hampelThreshold?: number;
		removeBaselineWander?: boolean;
		enhancePeaks?: boolean;
		scaleData?: boolean;
	};
	
	// Quality and cleaning options
	quality?: {
		rejectSegmentwise?: boolean;
		segmentRejectThreshold?: number;
		segmentRejectMaxRejects?: number;
		segmentRejectWindowBeats?: number;
		segmentRejectOverlap?: number; // 0..1
		cleanRR?: boolean;
		cleanMethod?: 'quotient-filter' | 'iqr' | 'z-score';
		thresholdRR?: boolean; // HeartPy threshold_rr
	};

	// Time-domain controls
	timeDomain?: {
		sdsdMode?: 'signed' | 'abs'; // default 'abs' (HP)
		pnnAsPercent?: boolean; // true: 0..100, false: 0..1 (HP)
	};

	// Poincaré controls
	poincare?: {
		mode?: 'formula' | 'masked'; // default 'masked' (HP)
	};
	
	// High precision mode
	highPrecision?: {
		enabled?: boolean;
		targetFs?: number;
	};

	// RR spline smoothing
	rrSpline?: {
		s?: number; // smoothing factor (lambda)
		targetSse?: number; // Reinsch target SSE
		smooth?: number; // 0..1 pre-smooth blend
	};
	
	// Segmentwise analysis
	segmentwise?: {
		width?: number; // seconds
		overlap?: number; // 0-1
		minSize?: number; // seconds
		replaceOutliers?: boolean;
	};

	// Output controls
	breathingAsBpm?: boolean;
};

export type QualityInfo = {
	totalBeats: number;
	rejectedBeats: number;
	rejectionRate: number;
	goodQuality: boolean;
	qualityWarning?: string;
};

export type HeartPyResult = {
	// Basic metrics
	bpm: number;
	ibiMs: number[];
	rrList: number[];
	peakList: number[];
	
	// Time domain measures
	sdnn: number;
	rmssd: number;
	sdsd: number;
	pnn20: number;
	pnn50: number;
	nn20: number;
	nn50: number;
	mad: number;
	
	// Poincaré analysis
	sd1: number;
	sd2: number;
	sd1sd2Ratio: number;
	ellipseArea: number;
	
	// Frequency domain
	vlf: number;
	lf: number;
	hf: number;
	lfhf: number;
	totalPower: number;
	lfNorm: number;
	hfNorm: number;
	
	// Breathing analysis
	breathingRate: number;
	
	// Quality metrics
	quality: QualityInfo;
	
	// Segmentwise results (if applicable)
	segments?: HeartPyResult[];
};

export function analyze(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): HeartPyResult {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyze) throw new Error('HeartPyModule.analyze not available');
	const arr = (signal instanceof Float64Array ? Array.from(signal) : signal) as number[];
	return Native.analyze(arr, fs, options ?? {});
}

export function analyzeSegmentwise(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): HeartPyResult {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyzeSegmentwise) throw new Error('HeartPyModule.analyzeSegmentwise not available');
	const arr = (signal instanceof Float64Array ? Array.from(signal) : signal) as number[];
	return Native.analyzeSegmentwise(arr, fs, options ?? {});
}

export function analyzeRR(rrIntervals: number[], options?: HeartPyOptions): HeartPyResult {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyzeRR) throw new Error('HeartPyModule.analyzeRR not available');
	return Native.analyzeRR(rrIntervals, options ?? {});
}

// Preprocessing functions
export function interpolateClipping(signal: number[], fs: number, threshold: number = 1020): number[] {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.interpolateClipping) throw new Error('HeartPyModule.interpolateClipping not available');
	return Native.interpolateClipping(signal, fs, threshold);
}

export function hampelFilter(signal: number[], windowSize: number = 6, threshold: number = 3.0): number[] {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.hampelFilter) throw new Error('HeartPyModule.hampelFilter not available');
	return Native.hampelFilter(signal, windowSize, threshold);
}

export function scaleData(signal: number[], newMin: number = 0, newMax: number = 1024): number[] {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.scaleData) throw new Error('HeartPyModule.scaleData not available');
	return Native.scaleData(signal, newMin, newMax);
}


// Async variants: avoid blocking the JS thread
export async function analyzeAsync(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): Promise<HeartPyResult> {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyzeAsync) throw new Error('HeartPyModule.analyzeAsync not available');
	const arr = (signal instanceof Float64Array ? Array.from(signal) : signal) as number[];
	return Native.analyzeAsync(arr, fs, options ?? {});
}

export async function analyzeSegmentwiseAsync(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): Promise<HeartPyResult> {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyzeSegmentwiseAsync) throw new Error('HeartPyModule.analyzeSegmentwiseAsync not available');
	const arr = (signal instanceof Float64Array ? Array.from(signal) : signal) as number[];
	return Native.analyzeSegmentwiseAsync(arr, fs, options ?? {});
}

export async function analyzeRRAsync(rrIntervals: number[], options?: HeartPyOptions): Promise<HeartPyResult> {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.analyzeRRAsync) throw new Error('HeartPyModule.analyzeRRAsync not available');
	return Native.analyzeRRAsync(rrIntervals, options ?? {});
}

// Optional JSI path (iOS installed via installJSI)
// ------------------------------
// Step 0: Risk mitigation flags & profiling (JS-only)
// ------------------------------

type RuntimeConfig = {
    jsiEnabled: boolean;
    zeroCopyEnabled: boolean;
    debug: boolean;
    maxSamplesPerPush: number;
};

const DEFAULT_CFG: RuntimeConfig = {
    jsiEnabled: true,
    zeroCopyEnabled: true,
    debug: false,
    maxSamplesPerPush: 5000,
};

let cfg: RuntimeConfig = { ...DEFAULT_CFG };
let sessionJSIDisabled = false; // permanent for this session once disabled

// Stats/profiling
const pushDurationsMs: number[] = [];
const pollDurationsMs: number[] = [];
let jsCalls = 0, nmCalls = 0, jsiCalls = 0;

function loadNativeConfig() {
    try {
        const { NativeModules } = require('react-native');
        const Native: any = NativeModules?.HeartPyModule;
        if (Native?.getConfig) {
            const m = Native.getConfig();
            cfg = {
                jsiEnabled: m?.jsiEnabled ?? cfg.jsiEnabled,
                zeroCopyEnabled: m?.zeroCopyEnabled ?? cfg.zeroCopyEnabled,
                debug: m?.debug ?? cfg.debug,
                maxSamplesPerPush: m?.maxSamplesPerPush ?? cfg.maxSamplesPerPush,
            };
        }
    } catch {}
}
loadNativeConfig();

function recordDuration(buf: number[], ms: number, cap = 100) {
    buf.push(ms);
    if (buf.length > cap) buf.shift();
}
function pctl(buf: number[], p: number): number {
    if (!buf.length) return 0;
    const a = buf.slice().sort((x, y) => x - y);
    const idx = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * (a.length - 1))));
    return a[idx];
}

export function installJSI(): boolean {
    const { NativeModules } = require('react-native');
    const Native: any = NativeModules?.HeartPyModule;
    if (sessionJSIDisabled || !cfg.jsiEnabled || !Native?.installJSI) return false;
    try {
        const ok = !!Native.installJSI();
        if (!ok) sessionJSIDisabled = true; // rollback for session
        return ok;
    } catch (e) {
        // HEARTPY_E901: JSI unavailable
        if (cfg.debug) console.warn('HEARTPY_E901: JSI install failed', e);
        sessionJSIDisabled = true; // rollback for session
        return false;
    }
}

export function analyzeJSI(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): HeartPyResult {
	const g: any = global as any;
	if (g && typeof g.__HeartPyAnalyze === 'function') {
		return g.__HeartPyAnalyze(signal, fs, options ?? {});
	}
	throw new Error('JSI analyze not installed. Call installJSI() on iOS, or use NativeModules/async methods.');
}

// ------------------------------
// Realtime Streaming (NativeModules P0)
// ------------------------------

type HeartPyMetrics = HeartPyResult; // streaming returns same shape

export async function rtCreate(fs: number, options?: HeartPyOptions): Promise<number> {
    const { NativeModules } = require('react-native');
    const Native: any = NativeModules?.HeartPyModule;
    if (!Native?.rtCreate) throw new Error('HeartPyModule.rtCreate not available');
    jsCalls++;
    if (!(fs >= 1 && fs <= 10000)) {
        const err: any = new Error(`Invalid sample rate: ${fs}. Must be 1-10000 Hz.`);
        err.code = 'HEARTPY_E001';
        throw err;
    }
    return Native.rtCreate(fs, options ?? {});
}

export async function rtPush(handle: number, samples: Float32Array | number[], t0?: number): Promise<void> {
    const { NativeModules } = require('react-native');
    const Native: any = NativeModules?.HeartPyModule;
    if (!Native?.rtPush) throw new Error('HeartPyModule.rtPush not available');
    jsCalls++;
    const len = (samples instanceof Float32Array ? samples.length : Array.isArray(samples) ? samples.length : 0);
    if (!handle) { const e: any = new Error('Invalid or destroyed handle'); e.code = 'HEARTPY_E101'; throw e; }
    if (!len) { const e: any = new Error('Invalid data buffer: empty buffer'); e.code = 'HEARTPY_E102'; throw e; }
    if (len > cfg.maxSamplesPerPush) { const e: any = new Error(`Invalid data buffer: too large (max ${cfg.maxSamplesPerPush})`); e.code = 'HEARTPY_E102'; throw e; }
    const arr = (samples instanceof Float32Array ? Array.from(samples) : samples) as number[];
    const t1 = Date.now();
    const p = Native.rtPush(handle, arr, t0 ?? 0);
    nmCalls++;
    return p?.then?.(() => { recordDuration(pushDurationsMs, Date.now() - t1); }) ?? p;
}

export async function rtPoll(handle: number): Promise<HeartPyMetrics | null> {
    const { NativeModules } = require('react-native');
    const Native: any = NativeModules?.HeartPyModule;
    if (!Native?.rtPoll) throw new Error('HeartPyModule.rtPoll not available');
    jsCalls++;
    const t1 = Date.now();
    const p = Native.rtPoll(handle);
    nmCalls++;
    return p?.then?.((res: any) => { recordDuration(pollDurationsMs, Date.now() - t1); return res; }) ?? p;
}

export async function rtDestroy(handle: number): Promise<void> {
    const { NativeModules } = require('react-native');
    const Native: any = NativeModules?.HeartPyModule;
    if (!Native?.rtDestroy) throw new Error('HeartPyModule.rtDestroy not available');
    return Native.rtDestroy(handle);
}

export class RealtimeAnalyzer {
    private handle: number = 0;
    private constructor(h: number) { this.handle = h; }

    static async create(fs: number, options?: HeartPyOptions): Promise<RealtimeAnalyzer> {
        const h = await rtCreate(fs, options);
        return new RealtimeAnalyzer(h);
    }

    async push(samples: Float32Array | number[], t0?: number): Promise<void> {
        if (!this.handle) throw new Error('RealtimeAnalyzer destroyed');
        return rtPush(this.handle, samples, t0);
    }

    async poll(): Promise<HeartPyMetrics | null> {
        if (!this.handle) throw new Error('RealtimeAnalyzer destroyed');
        return rtPoll(this.handle);
    }

    async destroy(): Promise<void> {
        if (!this.handle) return; // idempotent
        const h = this.handle; this.handle = 0;
        try { await rtDestroy(h); } catch {}
    }

    // Allow dev-time override of flags
    static setConfig(next: Partial<RuntimeConfig>) {
        cfg = { ...cfg, ...next } as RuntimeConfig;
        try {
            const { NativeModules } = require('react-native');
            const Native: any = NativeModules?.HeartPyModule;
            if (Native?.setConfig) Native.setConfig(next);
        } catch {}
    }
}

// Debugger utility
export const HeartPyDebugger = {
    getStats() {
        return {
            jsCalls,
            jsiCalls,
            nmCalls,
            pushMsP50: pctl(pushDurationsMs, 50),
            pushMsP95: pctl(pushDurationsMs, 95),
            pollMsP50: pctl(pollDurationsMs, 50),
            pollMsP95: pctl(pollDurationsMs, 95),
        };
    },
};
}


