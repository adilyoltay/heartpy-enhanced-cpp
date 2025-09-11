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
export function installJSI(): boolean {
	const { NativeModules } = require('react-native');
	const Native: any = NativeModules?.HeartPyModule;
	if (!Native?.installJSI) return false;
	try { return !!Native.installJSI(); } catch { return false; }
}

export function analyzeJSI(signal: number[] | Float64Array, fs: number, options?: HeartPyOptions): HeartPyResult {
	const g: any = global as any;
	if (g && typeof g.__HeartPyAnalyze === 'function') {
		return g.__HeartPyAnalyze(signal, fs, options ?? {});
	}
	throw new Error('JSI analyze not installed. Call installJSI() on iOS, or use NativeModules/async methods.');
}


