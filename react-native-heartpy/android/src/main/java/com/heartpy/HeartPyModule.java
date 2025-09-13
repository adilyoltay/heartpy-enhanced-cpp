package com.heartpy;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.Arguments;
import com.facebook.jni.HybridData;
import com.facebook.react.bridge.ReactContext;
import android.util.Log;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.ConcurrentLinkedQueue;

public class HeartPyModule extends ReactContextBaseJavaModule {
    static {
        System.loadLibrary("heartpy_rn");
    }
    private static native String analyzeNativeJson(
            double[] signal, double fs,
            double lowHz, double highHz, int order,
            int nfft, double overlap, double welchWsizeSec,
            double refractoryMs, double thresholdScale, double bpmMin, double bpmMax,
            boolean interpClipping, double clippingThreshold,
            boolean hampelCorrect, int hampelWindow, double hampelThreshold,
            boolean removeBaselineWander, boolean enhancePeaks,
            boolean highPrecision, double highPrecisionFs,
            boolean rejectSegmentwise, double segmentRejectThreshold, int segmentRejectMaxRejects, int segmentRejectWindowBeats, double segmentRejectOverlap,
            boolean cleanRR, int cleanMethod,
            double segmentWidth, double segmentOverlap, double segmentMinSize, boolean replaceOutliers,
            double rrSplineS, double rrSplineTargetSse, double rrSplineSmooth,
            boolean breathingAsBpm,
            int sdsdMode,
            int poincareMode,
            boolean pnnAsPercent
    );

    private static native String analyzeRRNativeJson(
            double[] rr,
            boolean cleanRR, int cleanMethod,
            boolean breathingAsBpm,
            boolean thresholdRR,
            int sdsdMode,
            int poincareMode,
            boolean pnnAsPercent
    );

    private static native String analyzeSegmentwiseNativeJson(
            double[] signal, double fs,
            double lowHz, double highHz, int order,
            int nfft, double overlap, double welchWsizeSec,
            double refractoryMs, double thresholdScale, double bpmMin, double bpmMax,
            boolean interpClipping, double clippingThreshold,
            boolean hampelCorrect, int hampelWindow, double hampelThreshold,
            boolean removeBaselineWander, boolean enhancePeaks,
            boolean highPrecision, double highPrecisionFs,
            boolean rejectSegmentwise, double segmentRejectThreshold, int segmentRejectMaxRejects, int segmentRejectWindowBeats, double segmentRejectOverlap,
            boolean cleanRR, int cleanMethod,
            double segmentWidth, double segmentOverlap, double segmentMinSize, boolean replaceOutliers,
            double rrSplineS, double rrSplineTargetSse, double rrSplineSmooth,
            boolean breathingAsBpm,
            int sdsdMode,
            int poincareMode,
            boolean pnnAsPercent
    );

    private static native double[] interpolateClippingNative(double[] signal, double fs, double threshold);
    private static native double[] hampelFilterNative(double[] signal, int windowSize, double threshold);
    private static native double[] scaleDataNative(double[] signal, double newMin, double newMax);

    // Realtime streaming native bindings (P0)
    private static native long rtCreateNative(
            double fs,
            double lowHz, double highHz, int order,
            int nfft, double overlap, double welchWsizeSec,
            double refractoryMs, double thresholdScale, double bpmMin, double bpmMax,
            boolean interpClipping, double clippingThreshold,
            boolean hampelCorrect, int hampelWindow, double hampelThreshold,
            boolean removeBaselineWander, boolean enhancePeaks,
            boolean highPrecision, double highPrecisionFs,
            boolean rejectSegmentwise, double segmentRejectThreshold, int segmentRejectMaxRejects, int segmentRejectWindowBeats, double segmentRejectOverlap,
            boolean cleanRR, int cleanMethod,
            double segmentWidth, double segmentOverlap, double segmentMinSize, boolean replaceOutliers,
            double rrSplineS, double rrSplineTargetSse, double rrSplineSmooth,
            boolean breathingAsBpm,
            int sdsdMode,
            int poincareMode,
            boolean pnnAsPercent
    );
    private static native void rtPushNative(long handle, double[] samples, double t0);
    private static native void rtPushTsNative(long handle, double[] samples, double[] timestamps);
    private static native String rtPollNative(long handle);
    private static native void rtDestroyNative(long handle);
    private static native String rtValidateOptionsNative(double fs,
                                                         double lowHz, double highHz,
                                                         int order,
                                                         int nfft,
                                                         double overlap,
                                                         double welchWsizeSec,
                                                         double refractoryMs,
                                                         double bpmMin, double bpmMax,
                                                         double highPrecisionFs);
    private static native void installJSIHybrid(long runtimePtr);
    private static native void setZeroCopyEnabledNative(boolean enabled);
    private static native long[] getJSIStatsNative();

    // ---------- Step 0: Risk mitigation flags & profiling ----------
    private static volatile boolean CFG_JSI_ENABLED = true;
    private static volatile boolean CFG_ZERO_COPY_ENABLED = true; // honored in JSI step
    private static volatile boolean CFG_DEBUG = false;
    private static final int MAX_SAMPLES_PER_PUSH = 5000;

    private static final AtomicInteger NM_PUSH_SUBMIT = new AtomicInteger(0);
    private static final AtomicInteger NM_PUSH_DONE = new AtomicInteger(0);
    private static final AtomicInteger NM_POLL_SUBMIT = new AtomicInteger(0);
    private static final AtomicInteger NM_POLL_DONE = new AtomicInteger(0);

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableMap getConfig() {
        com.facebook.react.bridge.WritableMap map = com.facebook.react.bridge.Arguments.createMap();
        map.putBoolean("jsiEnabled", CFG_JSI_ENABLED);
        map.putBoolean("zeroCopyEnabled", CFG_ZERO_COPY_ENABLED);
        map.putBoolean("debug", CFG_DEBUG);
        map.putInt("maxSamplesPerPush", MAX_SAMPLES_PER_PUSH);
        return map;
    }

    @ReactMethod
    public void setConfig(com.facebook.react.bridge.ReadableMap cfg) {
        if (cfg == null) return;
        try {
            if (cfg.hasKey("jsiEnabled")) CFG_JSI_ENABLED = cfg.getBoolean("jsiEnabled");
            if (cfg.hasKey("zeroCopyEnabled")) {
                CFG_ZERO_COPY_ENABLED = cfg.getBoolean("zeroCopyEnabled");
                try { setZeroCopyEnabledNative(CFG_ZERO_COPY_ENABLED); } catch (Throwable ignore) {}
            }
            if (cfg.hasKey("debug")) CFG_DEBUG = cfg.getBoolean("debug");
            Log.d("HeartPyJSI", "setConfig jsi=" + CFG_JSI_ENABLED + " zeroCopy=" + CFG_ZERO_COPY_ENABLED + " debug=" + CFG_DEBUG);
        } catch (Throwable t) {
            Log.w("HeartPyJSI", "setConfig error: " + t.getMessage());
        }
    }

    public HeartPyModule(@NonNull ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "HeartPyModule";
    }

    // Cross-platform PPG buffer (Android parity with iOS notification path)
    private static final ConcurrentLinkedQueue<Double> PPG_BUFFER = new ConcurrentLinkedQueue<>();
    public static void addPPGSample(double value) {
        try {
            if (Double.isNaN(value) || Double.isInfinite(value)) return;
            PPG_BUFFER.add(value);
            // Keep last ~300 samples
            while (PPG_BUFFER.size() > 300) {
                PPG_BUFFER.poll();
            }
        } catch (Throwable ignore) {}
    }

    // Last confidence value (0..1)
    private static volatile double LAST_PPG_CONF = 0.0;
    public static void addPPGSampleConfidence(double confidence) {
        try {
            if (Double.isNaN(confidence) || Double.isInfinite(confidence)) return;
            if (confidence < 0.0) confidence = 0.0; if (confidence > 1.0) confidence = 1.0;
            LAST_PPG_CONF = confidence;
        } catch (Throwable ignore) {}
    }

    @ReactMethod
    public void getLatestPPGSamples(Promise promise) {
        final WritableArray out = Arguments.createArray();
        try {
            int drained = 0;
            while (true) {
                final Double v = PPG_BUFFER.poll();
                if (v == null) break;
                out.pushDouble(v);
                drained++;
                if (drained >= 1000) break; // safety cap
            }
            promise.resolve(out);
        } catch (Throwable t) {
            promise.reject("ppg_buffer_error", t);
        }
    }

    @ReactMethod
    public void getLastPPGConfidence(Promise promise) {
        try {
            promise.resolve(LAST_PPG_CONF);
        } catch (Throwable t) {
            promise.reject("ppg_conf_error", t);
        }
    }

    // Install Android JSI bindings (blocking, sync)
    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean installJSI() {
        try {
            long ptr = getReactApplicationContext().getJavaScriptContextHolder().get();
            if (ptr == 0) {
                Log.w("HeartPyJSI", "HEARTPY_E901: JS runtime ptr is 0");
                return false;
            }
            installJSIHybrid(ptr);
            Log.d("HeartPyJSI", "installJSIHybrid: success");
            return true;
        } catch (Throwable t) {
            Log.e("HeartPyJSI", "HEARTPY_E900: installJSI failed: " + t.getMessage());
            return false;
        }
    }

    // Debug-only JSI stats: zero-copy vs fallback counts
    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableMap getJSIStats() {
        com.facebook.react.bridge.WritableMap out = com.facebook.react.bridge.Arguments.createMap();
        try {
            long[] vals = getJSIStatsNative();
            out.putDouble("zeroCopyUsed", (double) (vals != null && vals.length > 0 ? vals[0] : 0));
            out.putDouble("fallbackUsed", (double) (vals != null && vals.length > 1 ? vals[1] : 0));
        } catch (Throwable t) {
            out.putString("error", t.getMessage());
        }
        return out;
    }

    // Single-thread executors per realtime analyzer handle
    private static final java.util.concurrent.ConcurrentHashMap<Long, java.util.concurrent.ExecutorService> EXECUTORS = new java.util.concurrent.ConcurrentHashMap<>();
    private static java.util.concurrent.ExecutorService executorFor(long handle) {
        return EXECUTORS.computeIfAbsent(handle, h -> {
            java.util.concurrent.ExecutorService ex = java.util.concurrent.Executors.newSingleThreadExecutor();
            try { Log.d("HeartPyRT", "executor.create handle="+h+" active="+EXECUTORS.size()); } catch (Throwable t) {}
            return ex;
        });
    }
    private static void shutdownExecutor(long handle) {
        java.util.concurrent.ExecutorService ex = EXECUTORS.remove(handle);
        if (ex != null) {
            ex.shutdownNow();
            try { Log.d("HeartPyRT", "executor.shutdown handle="+handle+" active="+EXECUTORS.size()); } catch (Throwable t) {}
        }
    }

    private static com.facebook.react.bridge.WritableMap jsonToWritableMap(String json) {
        try {
            org.json.JSONObject obj = new org.json.JSONObject(json);
            return toWritableMap(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static com.facebook.react.bridge.WritableMap toWritableMap(org.json.JSONObject obj) throws org.json.JSONException {
        com.facebook.react.bridge.WritableMap map = com.facebook.react.bridge.Arguments.createMap();
        java.util.Iterator<String> it = obj.keys();
        while (it.hasNext()) {
            String k = it.next();
            Object v = obj.get(k);
            if (v == org.json.JSONObject.NULL) {
                map.putNull(k);
            } else if (v instanceof org.json.JSONObject) {
                map.putMap(k, toWritableMap((org.json.JSONObject) v));
            } else if (v instanceof org.json.JSONArray) {
                map.putArray(k, toWritableArray((org.json.JSONArray) v));
            } else if (v instanceof Boolean) {
                map.putBoolean(k, (Boolean) v);
            } else if (v instanceof Integer) {
                map.putInt(k, (Integer) v);
            } else if (v instanceof Long) {
                map.putDouble(k, ((Long) v).doubleValue());
            } else if (v instanceof Double) {
                map.putDouble(k, (Double) v);
            } else if (v instanceof String) {
                map.putString(k, (String) v);
            } else {
                map.putString(k, String.valueOf(v));
            }
        }
        return map;
    }

    private static com.facebook.react.bridge.WritableArray toWritableArray(org.json.JSONArray arr) throws org.json.JSONException {
        com.facebook.react.bridge.WritableArray out = com.facebook.react.bridge.Arguments.createArray();
        for (int i = 0; i < arr.length(); i++) {
            Object v = arr.get(i);
            if (v == org.json.JSONObject.NULL) {
                out.pushNull();
            } else if (v instanceof org.json.JSONObject) {
                out.pushMap(toWritableMap((org.json.JSONObject) v));
            } else if (v instanceof org.json.JSONArray) {
                out.pushArray(toWritableArray((org.json.JSONArray) v));
            } else if (v instanceof Boolean) {
                out.pushBoolean((Boolean) v);
            } else if (v instanceof Integer) {
                out.pushInt((Integer) v);
            } else if (v instanceof Long) {
                out.pushDouble(((Long) v).doubleValue());
            } else if (v instanceof Double) {
                out.pushDouble((Double) v);
            } else if (v instanceof String) {
                out.pushString((String) v);
            } else {
                out.pushString(String.valueOf(v));
            }
        }
        return out;
    }

    private static class Opts {
        double lowHz=0.5, highHz=5.0; int order=2; int nfft=256; double overlap=0.5; double wsizeSec=240.0;
        double refractoryMs=250.0, thresholdScale=0.5, bpmMin=40.0, bpmMax=180.0;
        boolean interpClipping=false; double clippingThreshold=1020.0; boolean hampelCorrect=false; int hampelWindow=6; double hampelThreshold=3.0;
        boolean removeBaselineWander=false, enhancePeaks=false;
        boolean highPrecision=false; double highPrecisionFs=1000.0;
        boolean rejectSegmentwise=false; double segmentRejectThreshold=0.3; int segmentRejectMaxRejects=3; int segmentRejectWindowBeats=10; double segmentRejectOverlap=0.0; boolean cleanRR=false; int cleanMethod=0;
        double segmentWidth=120.0, segmentOverlap=0.0, segmentMinSize=20.0; boolean replaceOutliers=false;
        double rrSplineS=10.0, rrSplineTargetSse=0.0, rrSplineSmooth=0.1;
        boolean breathingAsBpm=false;
        boolean thresholdRR=false;
        int sdsdMode=1; // 1=abs, 0=signed
        int poincareMode=1; // 1=masked, 0=formula
        boolean pnnAsPercent=true;
    }

    private static Opts parseOptions(com.facebook.react.bridge.ReadableMap options) {
        Opts o = new Opts();
        if (options == null) return o;
        if (options.hasKey("bandpass")) {
            com.facebook.react.bridge.ReadableMap bp = options.getMap("bandpass");
            if (bp.hasKey("lowHz")) o.lowHz = bp.getDouble("lowHz");
            if (bp.hasKey("highHz")) o.highHz = bp.getDouble("highHz");
            if (bp.hasKey("order")) o.order = bp.getInt("order");
        }
        if (options.hasKey("welch")) {
            com.facebook.react.bridge.ReadableMap w = options.getMap("welch");
            if (w.hasKey("nfft")) o.nfft = w.getInt("nfft");
            if (w.hasKey("overlap")) o.overlap = w.getDouble("overlap");
            if (w.hasKey("wsizeSec")) o.wsizeSec = w.getDouble("wsizeSec");
        }
        if (options.hasKey("peak")) {
            com.facebook.react.bridge.ReadableMap p = options.getMap("peak");
            if (p.hasKey("refractoryMs")) o.refractoryMs = p.getDouble("refractoryMs");
            if (p.hasKey("thresholdScale")) o.thresholdScale = p.getDouble("thresholdScale");
            if (p.hasKey("bpmMin")) o.bpmMin = p.getDouble("bpmMin");
            if (p.hasKey("bpmMax")) o.bpmMax = p.getDouble("bpmMax");
        }
        if (options.hasKey("preprocessing")) {
            com.facebook.react.bridge.ReadableMap prep = options.getMap("preprocessing");
            if (prep.hasKey("interpClipping")) o.interpClipping = prep.getBoolean("interpClipping");
            if (prep.hasKey("clippingThreshold")) o.clippingThreshold = prep.getDouble("clippingThreshold");
            if (prep.hasKey("hampelCorrect")) o.hampelCorrect = prep.getBoolean("hampelCorrect");
            if (prep.hasKey("hampelWindow")) o.hampelWindow = prep.getInt("hampelWindow");
            if (prep.hasKey("hampelThreshold")) o.hampelThreshold = prep.getDouble("hampelThreshold");
            if (prep.hasKey("removeBaselineWander")) o.removeBaselineWander = prep.getBoolean("removeBaselineWander");
            if (prep.hasKey("enhancePeaks")) o.enhancePeaks = prep.getBoolean("enhancePeaks");
        }
        if (options.hasKey("quality")) {
            com.facebook.react.bridge.ReadableMap q = options.getMap("quality");
            if (q.hasKey("rejectSegmentwise")) o.rejectSegmentwise = q.getBoolean("rejectSegmentwise");
            if (q.hasKey("segmentRejectThreshold")) o.segmentRejectThreshold = q.getDouble("segmentRejectThreshold");
            if (q.hasKey("segmentRejectMaxRejects")) o.segmentRejectMaxRejects = q.getInt("segmentRejectMaxRejects");
            if (q.hasKey("cleanRR")) o.cleanRR = q.getBoolean("cleanRR");
            if (q.hasKey("segmentRejectWindowBeats")) o.segmentRejectWindowBeats = q.getInt("segmentRejectWindowBeats");
            if (q.hasKey("segmentRejectOverlap")) o.segmentRejectOverlap = q.getDouble("segmentRejectOverlap");
            if (q.hasKey("cleanMethod")) {
                String m = q.getString("cleanMethod");
                if ("iqr".equals(m)) o.cleanMethod = 1;
                else if ("z-score".equals(m)) o.cleanMethod = 2;
                else o.cleanMethod = 0;
            }
            if (q.hasKey("thresholdRR")) o.thresholdRR = q.getBoolean("thresholdRR");
        }
        if (options.hasKey("timeDomain")) {
            com.facebook.react.bridge.ReadableMap td = options.getMap("timeDomain");
            if (td.hasKey("sdsdMode")) {
                String m = td.getString("sdsdMode");
                o.sdsdMode = ("signed".equals(m) ? 0 : 1);
            }
            if (td.hasKey("pnnAsPercent")) o.pnnAsPercent = td.getBoolean("pnnAsPercent");
        }
        if (options.hasKey("poincare")) {
            com.facebook.react.bridge.ReadableMap pc = options.getMap("poincare");
            if (pc.hasKey("mode")) {
                String m = pc.getString("mode");
                o.poincareMode = ("masked".equals(m) ? 1 : 0);
            }
        }
        if (options.hasKey("highPrecision")) {
            com.facebook.react.bridge.ReadableMap hp = options.getMap("highPrecision");
            if (hp.hasKey("enabled")) o.highPrecision = hp.getBoolean("enabled");
            if (hp.hasKey("targetFs")) o.highPrecisionFs = hp.getDouble("targetFs");
        }
        if (options.hasKey("segmentwise")) {
            com.facebook.react.bridge.ReadableMap seg = options.getMap("segmentwise");
            if (seg.hasKey("width")) o.segmentWidth = seg.getDouble("width");
            if (seg.hasKey("overlap")) o.segmentOverlap = seg.getDouble("overlap");
            if (seg.hasKey("minSize")) o.segmentMinSize = seg.getDouble("minSize");
            if (seg.hasKey("replaceOutliers")) o.replaceOutliers = seg.getBoolean("replaceOutliers");
        }
        if (options.hasKey("rrSpline")) {
            com.facebook.react.bridge.ReadableMap rr = options.getMap("rrSpline");
            if (rr.hasKey("s")) o.rrSplineS = rr.getDouble("s");
            if (rr.hasKey("targetSse")) o.rrSplineTargetSse = rr.getDouble("targetSse");
            if (rr.hasKey("smooth")) o.rrSplineSmooth = rr.getDouble("smooth");
        }
        if (options.hasKey("breathingAsBpm")) o.breathingAsBpm = options.getBoolean("breathingAsBpm");
        return o;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableMap analyze(double[] signal, double fs,
                                                         com.facebook.react.bridge.ReadableMap options) {
        Opts o = parseOptions(options);
        String json = analyzeNativeJson(signal, fs,
                o.lowHz, o.highHz, o.order,
                o.nfft, o.overlap, o.wsizeSec,
                o.refractoryMs, o.thresholdScale, o.bpmMin, o.bpmMax,
                o.interpClipping, o.clippingThreshold,
                o.hampelCorrect, o.hampelWindow, o.hampelThreshold,
                o.removeBaselineWander, o.enhancePeaks,
                o.highPrecision, o.highPrecisionFs,
                o.rejectSegmentwise, o.segmentRejectThreshold, o.segmentRejectMaxRejects, o.segmentRejectWindowBeats, o.segmentRejectOverlap,
                o.cleanRR, o.cleanMethod,
                o.segmentWidth, o.segmentOverlap, o.segmentMinSize, o.replaceOutliers,
                o.rrSplineS, o.rrSplineTargetSse, o.rrSplineSmooth,
                o.breathingAsBpm,
                o.sdsdMode,
                o.poincareMode,
                o.pnnAsPercent
        );
        return jsonToWritableMap(json);
    }

    @ReactMethod
    public void analyzeAsync(double[] signal, double fs,
                             com.facebook.react.bridge.ReadableMap options,
                             com.facebook.react.bridge.Promise promise) {
        new Thread(() -> {
            try {
                Opts o = parseOptions(options);
                String json = analyzeNativeJson(signal, fs,
                        o.lowHz, o.highHz, o.order,
                        o.nfft, o.overlap, o.wsizeSec,
                        o.refractoryMs, o.thresholdScale, o.bpmMin, o.bpmMax,
                        o.interpClipping, o.clippingThreshold,
                        o.hampelCorrect, o.hampelWindow, o.hampelThreshold,
                        o.removeBaselineWander, o.enhancePeaks,
                        o.highPrecision, o.highPrecisionFs,
                        o.rejectSegmentwise, o.segmentRejectThreshold, o.segmentRejectMaxRejects, o.segmentRejectWindowBeats, o.segmentRejectOverlap,
                        o.cleanRR, o.cleanMethod,
                        o.segmentWidth, o.segmentOverlap, o.segmentMinSize, o.replaceOutliers,
                        o.rrSplineS, o.rrSplineTargetSse, o.rrSplineSmooth,
                        o.breathingAsBpm,
                        o.sdsdMode,
                        o.poincareMode,
                        o.pnnAsPercent
                );
                promise.resolve(jsonToWritableMap(json));
            } catch (Exception e) {
                promise.reject("analyze_error", e);
            }
        }).start();
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableMap analyzeRR(double[] rr,
                                                           com.facebook.react.bridge.ReadableMap options) {
        Opts o = parseOptions(options);
        String json = analyzeRRNativeJson(rr, o.cleanRR, o.cleanMethod, o.breathingAsBpm, o.thresholdRR, o.sdsdMode, o.poincareMode, o.pnnAsPercent);
        return jsonToWritableMap(json);
    }

    @ReactMethod
    public void analyzeRRAsync(double[] rr,
                               com.facebook.react.bridge.ReadableMap options,
                               com.facebook.react.bridge.Promise promise) {
        new Thread(() -> {
            try {
                Opts o = parseOptions(options);
                String json = analyzeRRNativeJson(rr, o.cleanRR, o.cleanMethod, o.breathingAsBpm, o.thresholdRR, o.sdsdMode, o.poincareMode, o.pnnAsPercent);
                promise.resolve(jsonToWritableMap(json));
            } catch (Exception e) {
                promise.reject("analyzeRR_error", e);
            }
        }).start();
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableMap analyzeSegmentwise(double[] signal, double fs,
                                                                    com.facebook.react.bridge.ReadableMap options) {
        Opts o = parseOptions(options);
        String json = analyzeSegmentwiseNativeJson(signal, fs,
                o.lowHz, o.highHz, o.order,
                o.nfft, o.overlap, o.wsizeSec,
                o.refractoryMs, o.thresholdScale, o.bpmMin, o.bpmMax,
                o.interpClipping, o.clippingThreshold,
                o.hampelCorrect, o.hampelWindow, o.hampelThreshold,
                o.removeBaselineWander, o.enhancePeaks,
                o.highPrecision, o.highPrecisionFs,
                o.rejectSegmentwise, o.segmentRejectThreshold, o.segmentRejectMaxRejects, o.segmentRejectWindowBeats,
                o.segmentRejectOverlap,
                o.cleanRR, o.cleanMethod,
                o.segmentWidth, o.segmentOverlap, o.segmentMinSize, o.replaceOutliers,
                o.rrSplineS, o.rrSplineTargetSse, o.rrSplineSmooth,
                o.breathingAsBpm,
                o.sdsdMode,
                o.poincareMode,
                o.pnnAsPercent
        );
        return jsonToWritableMap(json);
    }

    @ReactMethod
    public void analyzeSegmentwiseAsync(double[] signal, double fs,
                                        com.facebook.react.bridge.ReadableMap options,
                                        com.facebook.react.bridge.Promise promise) {
        new Thread(() -> {
            try {
                Opts o = parseOptions(options);
                String json = analyzeSegmentwiseNativeJson(signal, fs,
                        o.lowHz, o.highHz, o.order,
                        o.nfft, o.overlap, o.wsizeSec,
                        o.refractoryMs, o.thresholdScale, o.bpmMin, o.bpmMax,
                        o.interpClipping, o.clippingThreshold,
                        o.hampelCorrect, o.hampelWindow, o.hampelThreshold,
                        o.removeBaselineWander, o.enhancePeaks,
                        o.highPrecision, o.highPrecisionFs,
                        o.rejectSegmentwise, o.segmentRejectThreshold, o.segmentRejectMaxRejects, o.segmentRejectWindowBeats,
                        o.segmentRejectOverlap,
                        o.cleanRR, o.cleanMethod,
                        o.segmentWidth, o.segmentOverlap, o.segmentMinSize, o.replaceOutliers,
                        o.rrSplineS, o.rrSplineTargetSse, o.rrSplineSmooth,
                        o.breathingAsBpm,
                        o.sdsdMode,
                        o.poincareMode,
                        o.pnnAsPercent
                );
                promise.resolve(jsonToWritableMap(json));
            } catch (Exception e) {
                promise.reject("analyzeSegmentwise_error", e);
            }
        }).start();
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableArray interpolateClipping(double[] signal, double fs, double threshold) {
        double[] y = interpolateClippingNative(signal, fs, threshold);
        com.facebook.react.bridge.WritableArray arr = com.facebook.react.bridge.Arguments.createArray();
        for (double v : y) arr.pushDouble(v);
        return arr;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableArray hampelFilter(double[] signal, int windowSize, double threshold) {
        double[] y = hampelFilterNative(signal, windowSize, threshold);
        com.facebook.react.bridge.WritableArray arr = com.facebook.react.bridge.Arguments.createArray();
        for (double v : y) arr.pushDouble(v);
        return arr;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public com.facebook.react.bridge.WritableArray scaleData(double[] signal, double newMin, double newMax) {
        double[] y = scaleDataNative(signal, newMin, newMax);
        com.facebook.react.bridge.WritableArray arr = com.facebook.react.bridge.Arguments.createArray();
        for (double v : y) arr.pushDouble(v);
        return arr;
    }

    // ------------------------------
    // Realtime Streaming (NativeModules P0)
    // ------------------------------

    @ReactMethod
    public void rtCreate(double fs, com.facebook.react.bridge.ReadableMap options, Promise promise) {
        try {
            Opts o = parseOptions(options);
            if (fs < 1.0 || fs > 10000.0) { promise.reject("HEARTPY_E001", "Invalid sample rate: " + fs + ". Must be 1-10000 Hz."); return; }
            // Native validation
            String vcode = rtValidateOptionsNative(fs, o.lowHz, o.highHz, o.order, o.nfft, o.overlap, o.wsizeSec, o.refractoryMs, o.bpmMin, o.bpmMax, o.highPrecisionFs);
            if (vcode != null) {
                String msg;
                switch (vcode) {
                    case "HEARTPY_E001": msg = "Invalid sample rate (1-10000 Hz)"; break;
                    case "HEARTPY_E011": msg = "Invalid bandpass (0<=low<high<=fs/2)"; break;
                    case "HEARTPY_E012": msg = "Invalid nfft (64-16384)"; break;
                    case "HEARTPY_E013": msg = "Invalid BPM range (30<=min<max<=240)"; break;
                    case "HEARTPY_E014": msg = "Invalid refractory (50-2000 ms)"; break;
                    default: msg = "Invalid options"; break;
                }
                promise.reject(vcode, msg);
                return;
            }
            long h = rtCreateNative(fs,
                    o.lowHz, o.highHz, o.order,
                    o.nfft, o.overlap, o.wsizeSec,
                    o.refractoryMs, o.thresholdScale, o.bpmMin, o.bpmMax,
                    o.interpClipping, o.clippingThreshold,
                    o.hampelCorrect, o.hampelWindow, o.hampelThreshold,
                    o.removeBaselineWander, o.enhancePeaks,
                    o.highPrecision, o.highPrecisionFs,
                    o.rejectSegmentwise, o.segmentRejectThreshold, o.segmentRejectMaxRejects, o.segmentRejectWindowBeats, o.segmentRejectOverlap,
                    o.cleanRR, o.cleanMethod,
                    o.segmentWidth, o.segmentOverlap, o.segmentMinSize, o.replaceOutliers,
                    o.rrSplineS, o.rrSplineTargetSse, o.rrSplineSmooth,
                    o.breathingAsBpm,
                    o.sdsdMode,
                    o.poincareMode,
                    o.pnnAsPercent);
            if (h == 0) { promise.reject("HEARTPY_E004", "hp_rt_create returned 0"); return; }
            promise.resolve(h);
        } catch (Exception e) {
            promise.reject("HEARTPY_E900", e);
        }
    }

    @ReactMethod
    public void rtPush(double handle, double[] samples, Double t0, Promise promise) {
        try {
            final long h = (long) handle;
            if (h == 0L) { promise.reject("HEARTPY_E101", "Invalid or destroyed handle"); return; }
            if (samples == null || samples.length == 0) { promise.reject("HEARTPY_E102", "Invalid data buffer: empty buffer"); return; }
            if (samples.length > MAX_SAMPLES_PER_PUSH) { promise.reject("HEARTPY_E102", "Invalid data buffer: too large (max " + MAX_SAMPLES_PER_PUSH + ")"); return; }
            final double ts0 = (t0 == null ? 0.0 : t0.doubleValue());
            executorFor(h).submit(() -> {
                try { rtPushNative(h, samples, ts0); promise.resolve(null); }
                catch (Exception e) { promise.reject("HEARTPY_E900", e); }
                finally { NM_PUSH_DONE.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.push.done="+NM_PUSH_DONE.get()); }
            });
            NM_PUSH_SUBMIT.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.push.submit="+NM_PUSH_SUBMIT.get());
        } catch (Exception e) {
            promise.reject("HEARTPY_E900", e);
        }
    }

    @ReactMethod
    public void rtPoll(double handle, Promise promise) {
        try {
            final long h = (long) handle;
            if (h == 0L) { promise.reject("HEARTPY_E111", "Invalid or destroyed handle"); return; }
            executorFor(h).submit(() -> {
                try {
                    String json = rtPollNative(h);
                    if (json == null) { promise.resolve(null); return; }
                    promise.resolve(jsonToWritableMap(json));
                } catch (Exception e) {
                    promise.reject("HEARTPY_E900", e);
                }
                finally { NM_POLL_DONE.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.poll.done="+NM_POLL_DONE.get()); }
            });
            NM_POLL_SUBMIT.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.poll.submit="+NM_POLL_SUBMIT.get());
        } catch (Exception e) {
            promise.reject("HEARTPY_E900", e);
        }
    }

    @ReactMethod
    public void rtDestroy(double handle, Promise promise) {
        try {
            final long h = (long) handle;
            if (h == 0L) { promise.resolve(null); return; }
            shutdownExecutor(h);
            rtDestroyNative(h);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("rt_destroy_error", e);
        }
    }

    @ReactMethod
    public void rtPushTs(double handle, double[] samples, double[] timestamps, Promise promise) {
        try {
            final long h = (long) handle;
            if (h == 0L) { promise.reject("HEARTPY_E101", "Invalid or destroyed handle"); return; }
            if (samples == null || timestamps == null || samples.length == 0 || timestamps.length == 0) { promise.reject("HEARTPY_E102", "Invalid buffers: empty"); return; }
            final int k = Math.min(samples.length, timestamps.length);
            if (k > MAX_SAMPLES_PER_PUSH) { promise.reject("HEARTPY_E102", "Invalid data buffer: too large (max " + MAX_SAMPLES_PER_PUSH + ")"); return; }
            final double[] xs = (samples.length == k ? samples : java.util.Arrays.copyOf(samples, k));
            final double[] ts = (timestamps.length == k ? timestamps : java.util.Arrays.copyOf(timestamps, k));
            executorFor(h).submit(() -> {
                try { rtPushTsNative(h, xs, ts); promise.resolve(null); }
                catch (Exception e) { promise.reject("HEARTPY_E900", e); }
                finally { NM_PUSH_DONE.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.pushTs.done="+NM_PUSH_DONE.get()); }
            });
            NM_PUSH_SUBMIT.incrementAndGet(); if (CFG_DEBUG) Log.d("HeartPyRT", "nm.pushTs.submit="+NM_PUSH_SUBMIT.get());
        } catch (Exception e) {
            promise.reject("HEARTPY_E900", e);
        }
    }
}
