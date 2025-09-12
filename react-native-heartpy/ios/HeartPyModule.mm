#import "HeartPyModule.h"

#import <React/RCTBridge+Private.h>
#import <React/RCTCxxBridgeDelegate.h>
#import <React/RCTUtils.h>
#import <React/RCTBridge.h>
#import <jsi/jsi.h>

#include "../cpp/heartpy_core.h"
// Realtime streaming API
#include "../cpp/heartpy_stream.h"
// Options validator (RN step 1)
#include "cpp/rn_options_builder.h"

using namespace facebook;

static void installBinding(jsi::Runtime &rt) {
	auto analyzeFunc = jsi::Function::createFromHostFunction(
		rt,
		jsi::PropNameID::forAscii(rt, "__HeartPyAnalyze"),
		3,
		[](jsi::Runtime &rt, const jsi::Value &thisVal, const jsi::Value *args, size_t count) -> jsi::Value {
			if (count < 2) {
				throw jsi::JSError(rt, "analyze() requires signal and fs");
			}
			auto arrObj = args[0].asObject(rt);
			size_t len = (size_t)arrObj.getProperty(rt, "length").asNumber();
			std::vector<double> signal; signal.reserve(len);
			for (size_t i = 0; i < len; ++i) signal.push_back(arrObj.getPropertyAtIndex(rt, (uint32_t)i).asNumber());
			double fs = args[1].asNumber();
			heartpy::Options opt{};
			
			// Parse options if provided
			if (count > 2 && !args[2].isUndefined() && args[2].isObject()) {
				auto optObj = args[2].asObject(rt);
				
				// Bandpass options
				if (optObj.hasProperty(rt, "bandpass")) {
					auto bp = optObj.getProperty(rt, "bandpass").asObject(rt);
					if (bp.hasProperty(rt, "lowHz")) opt.lowHz = bp.getProperty(rt, "lowHz").asNumber();
					if (bp.hasProperty(rt, "highHz")) opt.highHz = bp.getProperty(rt, "highHz").asNumber();
					if (bp.hasProperty(rt, "order")) opt.iirOrder = bp.getProperty(rt, "order").asNumber();
				}
				
				// Welch options
				if (optObj.hasProperty(rt, "welch")) {
					auto w = optObj.getProperty(rt, "welch").asObject(rt);
					if (w.hasProperty(rt, "nfft")) opt.nfft = w.getProperty(rt, "nfft").asNumber();
					if (w.hasProperty(rt, "overlap")) opt.overlap = w.getProperty(rt, "overlap").asNumber();
				}
				
				// Peak detection options
				if (optObj.hasProperty(rt, "peak")) {
					auto p = optObj.getProperty(rt, "peak").asObject(rt);
					if (p.hasProperty(rt, "refractoryMs")) opt.refractoryMs = p.getProperty(rt, "refractoryMs").asNumber();
					if (p.hasProperty(rt, "thresholdScale")) opt.thresholdScale = p.getProperty(rt, "thresholdScale").asNumber();
					if (p.hasProperty(rt, "bpmMin")) opt.bpmMin = p.getProperty(rt, "bpmMin").asNumber();
					if (p.hasProperty(rt, "bpmMax")) opt.bpmMax = p.getProperty(rt, "bpmMax").asNumber();
				}
				
				// Preprocessing options
				if (optObj.hasProperty(rt, "preprocessing")) {
					auto prep = optObj.getProperty(rt, "preprocessing").asObject(rt);
					if (prep.hasProperty(rt, "interpClipping")) opt.interpClipping = prep.getProperty(rt, "interpClipping").asBool();
					if (prep.hasProperty(rt, "clippingThreshold")) opt.clippingThreshold = prep.getProperty(rt, "clippingThreshold").asNumber();
					if (prep.hasProperty(rt, "hampelCorrect")) opt.hampelCorrect = prep.getProperty(rt, "hampelCorrect").asBool();
					if (prep.hasProperty(rt, "hampelWindow")) opt.hampelWindow = prep.getProperty(rt, "hampelWindow").asNumber();
					if (prep.hasProperty(rt, "hampelThreshold")) opt.hampelThreshold = prep.getProperty(rt, "hampelThreshold").asNumber();
					if (prep.hasProperty(rt, "removeBaselineWander")) opt.removeBaselineWander = prep.getProperty(rt, "removeBaselineWander").asBool();
					if (prep.hasProperty(rt, "enhancePeaks")) opt.enhancePeaks = prep.getProperty(rt, "enhancePeaks").asBool();
				}
				
				// Quality options
				if (optObj.hasProperty(rt, "quality")) {
					auto qual = optObj.getProperty(rt, "quality").asObject(rt);
					if (qual.hasProperty(rt, "rejectSegmentwise")) opt.rejectSegmentwise = qual.getProperty(rt, "rejectSegmentwise").asBool();
					if (qual.hasProperty(rt, "segmentRejectThreshold")) opt.segmentRejectThreshold = qual.getProperty(rt, "segmentRejectThreshold").asNumber();
					if (qual.hasProperty(rt, "cleanRR")) opt.cleanRR = qual.getProperty(rt, "cleanRR").asBool();
					if (qual.hasProperty(rt, "cleanMethod")) {
						std::string method = qual.getProperty(rt, "cleanMethod").asString(rt).utf8(rt);
						if (method == "iqr") opt.cleanMethod = heartpy::Options::CleanMethod::IQR;
						else if (method == "z-score") opt.cleanMethod = heartpy::Options::CleanMethod::Z_SCORE;
						else opt.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER;
					}
				}
				
				// High precision options
				if (optObj.hasProperty(rt, "highPrecision")) {
					auto hp = optObj.getProperty(rt, "highPrecision").asObject(rt);
					if (hp.hasProperty(rt, "enabled")) opt.highPrecision = hp.getProperty(rt, "enabled").asBool();
					if (hp.hasProperty(rt, "targetFs")) opt.highPrecisionFs = hp.getProperty(rt, "targetFs").asNumber();
				}
				
				// Segmentwise options
				if (optObj.hasProperty(rt, "segmentwise")) {
					auto seg = optObj.getProperty(rt, "segmentwise").asObject(rt);
					if (seg.hasProperty(rt, "width")) opt.segmentWidth = seg.getProperty(rt, "width").asNumber();
					if (seg.hasProperty(rt, "overlap")) opt.segmentOverlap = seg.getProperty(rt, "overlap").asNumber();
					if (seg.hasProperty(rt, "minSize")) opt.segmentMinSize = seg.getProperty(rt, "minSize").asNumber();
					if (seg.hasProperty(rt, "replaceOutliers")) opt.replaceOutliers = seg.getProperty(rt, "replaceOutliers").asBool();
				}
			}
			
			auto res = heartpy::analyzeSignal(signal, fs, opt);
			jsi::Object out(rt);
			
			// Basic metrics
			out.setProperty(rt, "bpm", res.bpm);
			jsi::Array ibi(rt, res.ibiMs.size());
			for (size_t i = 0; i < res.ibiMs.size(); ++i) ibi.setValueAtIndex(rt, i, res.ibiMs[i]);
			out.setProperty(rt, "ibiMs", ibi);
			
			jsi::Array rrList(rt, res.rrList.size());
			for (size_t i = 0; i < res.rrList.size(); ++i) rrList.setValueAtIndex(rt, i, res.rrList[i]);
			out.setProperty(rt, "rrList", rrList);
			
			jsi::Array peakList(rt, res.peakList.size());
			for (size_t i = 0; i < res.peakList.size(); ++i) peakList.setValueAtIndex(rt, i, res.peakList[i]);
			out.setProperty(rt, "peakList", peakList);
			
			// Time domain metrics
			out.setProperty(rt, "sdnn", res.sdnn);
			out.setProperty(rt, "rmssd", res.rmssd);
			out.setProperty(rt, "sdsd", res.sdsd);
			out.setProperty(rt, "pnn20", res.pnn20);
			out.setProperty(rt, "pnn50", res.pnn50);
			out.setProperty(rt, "nn20", res.nn20);
			out.setProperty(rt, "nn50", res.nn50);
			out.setProperty(rt, "mad", res.mad);
			
		// Poincare analysis
		out.setProperty(rt, "sd1", res.sd1);
		out.setProperty(rt, "sd2", res.sd2);
		out.setProperty(rt, "sd1sd2Ratio", res.sd1sd2Ratio);
		out.setProperty(rt, "ellipseArea", res.ellipseArea);
		// Binary quality mask & raw peaks
		jsi::Array peakListRaw(rt, res.peakListRaw.size());
		for (size_t i = 0; i < res.peakListRaw.size(); ++i) peakListRaw.setValueAtIndex(rt, i, res.peakListRaw[i]);
		out.setProperty(rt, "peakListRaw", peakListRaw);
		jsi::Array binaryPeakMask(rt, res.binaryPeakMask.size());
		for (size_t i = 0; i < res.binaryPeakMask.size(); ++i) binaryPeakMask.setValueAtIndex(rt, i, res.binaryPeakMask[i]);
		out.setProperty(rt, "binaryPeakMask", binaryPeakMask);
		jsi::Array binSegs(rt, res.binarySegments.size());
		for (size_t i = 0; i < res.binarySegments.size(); ++i) {
			const auto &bs = res.binarySegments[i];
			jsi::Object o(rt);
			o.setProperty(rt, "index", bs.index);
			o.setProperty(rt, "startBeat", bs.startBeat);
			o.setProperty(rt, "endBeat", bs.endBeat);
			o.setProperty(rt, "totalBeats", bs.totalBeats);
			o.setProperty(rt, "rejectedBeats", bs.rejectedBeats);
			o.setProperty(rt, "accepted", bs.accepted);
			binSegs.setValueAtIndex(rt, i, o);
		}
		out.setProperty(rt, "binarySegments", binSegs);
			
			// Frequency domain
			out.setProperty(rt, "vlf", res.vlf);
			out.setProperty(rt, "lf", res.lf);
			out.setProperty(rt, "hf", res.hf);
			out.setProperty(rt, "lfhf", res.lfhf);
			out.setProperty(rt, "totalPower", res.totalPower);
			out.setProperty(rt, "lfNorm", res.lfNorm);
			out.setProperty(rt, "hfNorm", res.hfNorm);
			
			// Breathing analysis
			out.setProperty(rt, "breathingRate", res.breathingRate);
			
		// Quality info
		jsi::Object quality(rt);
		quality.setProperty(rt, "totalBeats", res.quality.totalBeats);
		quality.setProperty(rt, "rejectedBeats", res.quality.rejectedBeats);
		quality.setProperty(rt, "rejectionRate", res.quality.rejectionRate);
		quality.setProperty(rt, "goodQuality", res.quality.goodQuality);
		// rejectedIndices (if available)
		{
			jsi::Array rej(rt, res.quality.rejectedIndices.size());
			for (size_t i = 0; i < res.quality.rejectedIndices.size(); ++i) rej.setValueAtIndex(rt, i, res.quality.rejectedIndices[i]);
			quality.setProperty(rt, "rejectedIndices", rej);
		}
			if (!res.quality.qualityWarning.empty()) {
				quality.setProperty(rt, "qualityWarning", jsi::String::createFromUtf8(rt, res.quality.qualityWarning));
			}
			out.setProperty(rt, "quality", quality);
			
			return out;
		});
	rt.global().setProperty(rt, "__HeartPyAnalyze", analyzeFunc);
}

@implementation HeartPyModule

RCT_EXPORT_MODULE();

- (BOOL)requiresMainQueueSetup { return YES; }

static heartpy::Options optionsFromNSDictionary(NSDictionary* optDict) {
    heartpy::Options opt;
    if (!optDict) return opt;
    NSDictionary* bp = optDict[@"bandpass"];
    if ([bp isKindOfClass:[NSDictionary class]]) {
        if (bp[@"lowHz"]) opt.lowHz = [bp[@"lowHz"] doubleValue];
        if (bp[@"highHz"]) opt.highHz = [bp[@"highHz"] doubleValue];
        if (bp[@"order"]) opt.iirOrder = [bp[@"order"] intValue];
    }
    NSDictionary* w = optDict[@"welch"];
    if ([w isKindOfClass:[NSDictionary class]]) {
        if (w[@"nfft"]) opt.nfft = [w[@"nfft"] intValue];
        if (w[@"overlap"]) opt.overlap = [w[@"overlap"] doubleValue];
        if (w[@"wsizeSec"]) opt.welchWsizeSec = [w[@"wsizeSec"] doubleValue];
    }
    NSDictionary* p = optDict[@"peak"];
    if ([p isKindOfClass:[NSDictionary class]]) {
        if (p[@"refractoryMs"]) opt.refractoryMs = [p[@"refractoryMs"] doubleValue];
        if (p[@"thresholdScale"]) opt.thresholdScale = [p[@"thresholdScale"] doubleValue];
        if (p[@"bpmMin"]) opt.bpmMin = [p[@"bpmMin"] doubleValue];
        if (p[@"bpmMax"]) opt.bpmMax = [p[@"bpmMax"] doubleValue];
    }
    NSDictionary* prep = optDict[@"preprocessing"];
    if ([prep isKindOfClass:[NSDictionary class]]) {
        if (prep[@"interpClipping"]) opt.interpClipping = [prep[@"interpClipping"] boolValue];
        if (prep[@"clippingThreshold"]) opt.clippingThreshold = [prep[@"clippingThreshold"] doubleValue];
        if (prep[@"hampelCorrect"]) opt.hampelCorrect = [prep[@"hampelCorrect"] boolValue];
        if (prep[@"hampelWindow"]) opt.hampelWindow = [prep[@"hampelWindow"] intValue];
        if (prep[@"hampelThreshold"]) opt.hampelThreshold = [prep[@"hampelThreshold"] doubleValue];
        if (prep[@"removeBaselineWander"]) opt.removeBaselineWander = [prep[@"removeBaselineWander"] boolValue];
        if (prep[@"enhancePeaks"]) opt.enhancePeaks = [prep[@"enhancePeaks"] boolValue];
    }
    NSDictionary* qual = optDict[@"quality"];
    if ([qual isKindOfClass:[NSDictionary class]]) {
        if (qual[@"rejectSegmentwise"]) opt.rejectSegmentwise = [qual[@"rejectSegmentwise"] boolValue];
        if (qual[@"segmentRejectThreshold"]) opt.segmentRejectThreshold = [qual[@"segmentRejectThreshold"] doubleValue];
        if (qual[@"segmentRejectMaxRejects"]) opt.segmentRejectMaxRejects = [qual[@"segmentRejectMaxRejects"] intValue];
        if (qual[@"segmentRejectWindowBeats"]) opt.segmentRejectWindowBeats = [qual[@"segmentRejectWindowBeats"] intValue];
        if (qual[@"segmentRejectOverlap"]) opt.segmentRejectOverlap = [qual[@"segmentRejectOverlap"] doubleValue];
        if (qual[@"cleanRR"]) opt.cleanRR = [qual[@"cleanRR"] boolValue];
        if (qual[@"thresholdRR"]) opt.thresholdRR = [qual[@"thresholdRR"] boolValue];
        if ([qual[@"cleanMethod"] isKindOfClass:[NSString class]]) {
            NSString* method = (NSString*)qual[@"cleanMethod"];
            if ([method isEqualToString:@"iqr"]) opt.cleanMethod = heartpy::Options::CleanMethod::IQR;
            else if ([method isEqualToString:@"z-score"]) opt.cleanMethod = heartpy::Options::CleanMethod::Z_SCORE;
            else opt.cleanMethod = heartpy::Options::CleanMethod::QUOTIENT_FILTER;
        }
    }
    NSDictionary* td = optDict[@"timeDomain"];
    if ([td isKindOfClass:[NSDictionary class]]) {
        if ([td[@"sdsdMode"] isKindOfClass:[NSString class]]) {
            NSString* m = (NSString*)td[@"sdsdMode"];
            if ([m isEqualToString:@"signed"]) opt.sdsdMode = heartpy::Options::SdsdMode::SIGNED; else opt.sdsdMode = heartpy::Options::SdsdMode::ABS;
        }
        if (td[@"pnnAsPercent"]) opt.pnnAsPercent = [td[@"pnnAsPercent"] boolValue];
    }
    NSDictionary* pc = optDict[@"poincare"];
    if ([pc isKindOfClass:[NSDictionary class]]) {
        if ([pc[@"mode"] isKindOfClass:[NSString class]]) {
            NSString* m = (NSString*)pc[@"mode"];
            if ([m isEqualToString:@"masked"]) opt.poincareMode = heartpy::Options::PoincareMode::MASKED; else opt.poincareMode = heartpy::Options::PoincareMode::FORMULA;
        }
    }
    NSDictionary* hp = optDict[@"highPrecision"];
    if ([hp isKindOfClass:[NSDictionary class]]) {
        if (hp[@"enabled"]) opt.highPrecision = [hp[@"enabled"] boolValue];
        if (hp[@"targetFs"]) opt.highPrecisionFs = [hp[@"targetFs"] doubleValue];
    }
    NSDictionary* rr = optDict[@"rrSpline"];
    if ([rr isKindOfClass:[NSDictionary class]]) {
        if (rr[@"s"]) opt.rrSplineS = [rr[@"s"] doubleValue];
        if (rr[@"targetSse"]) opt.rrSplineSTargetSse = [rr[@"targetSse"] doubleValue];
        if (rr[@"smooth"]) opt.rrSplineSmooth = [rr[@"smooth"] doubleValue];
    }
    NSDictionary* seg = optDict[@"segmentwise"];
    if ([seg isKindOfClass:[NSDictionary class]]) {
        if (seg[@"width"]) opt.segmentWidth = [seg[@"width"] doubleValue];
        if (seg[@"overlap"]) opt.segmentOverlap = [seg[@"overlap"] doubleValue];
        if (seg[@"minSize"]) opt.segmentMinSize = [seg[@"minSize"] doubleValue];
        if (seg[@"replaceOutliers"]) opt.replaceOutliers = [seg[@"replaceOutliers"] boolValue];
    }
    if (optDict[@"breathingAsBpm"]) opt.breathingAsBpm = [optDict[@"breathingAsBpm"] boolValue];
    return opt;
}

// Synchronous bridge method to align with Android/TypeScript usage
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(analyze:(NSArray<NSNumber*>*)signal
                                    fs:(nonnull NSNumber*)fs
                                    options:(NSDictionary*)options)
{
    std::vector<double> x; x.reserve(signal.count);
    for (NSNumber* n in signal) x.push_back([n doubleValue]);
    heartpy::Options opt = optionsFromNSDictionary(options);
    auto res = heartpy::analyzeSignal(x, [fs doubleValue], opt);

    NSMutableDictionary* out = [NSMutableDictionary new];
    out[@"bpm"] = @(res.bpm);
    // Arrays
    NSMutableArray* ibi = [NSMutableArray arrayWithCapacity:res.ibiMs.size()];
    for (double v : res.ibiMs) [ibi addObject:@(v)];
    out[@"ibiMs"] = ibi;
    NSMutableArray* rr = [NSMutableArray arrayWithCapacity:res.rrList.size()];
    for (double v : res.rrList) [rr addObject:@(v)];
    out[@"rrList"] = rr;
    NSMutableArray* peaks = [NSMutableArray arrayWithCapacity:res.peakList.size()];
    for (int idx : res.peakList) [peaks addObject:@(idx)];
    out[@"peakList"] = peaks;
    // Time domain
    out[@"sdnn"] = @(res.sdnn);
    out[@"rmssd"] = @(res.rmssd);
    out[@"sdsd"] = @(res.sdsd);
    out[@"pnn20"] = @(res.pnn20);
    out[@"pnn50"] = @(res.pnn50);
    out[@"nn20"] = @(res.nn20);
    out[@"nn50"] = @(res.nn50);
    out[@"mad"] = @(res.mad);
    // Poincare
    out[@"sd1"] = @(res.sd1);
    out[@"sd2"] = @(res.sd2);
    out[@"sd1sd2Ratio"] = @(res.sd1sd2Ratio);
    out[@"ellipseArea"] = @(res.ellipseArea);
    // Frequency domain
    out[@"vlf"] = @(res.vlf);
    out[@"lf"] = @(res.lf);
    out[@"hf"] = @(res.hf);
    out[@"lfhf"] = @(res.lfhf);
    out[@"totalPower"] = @(res.totalPower);
    out[@"lfNorm"] = @(res.lfNorm);
    out[@"hfNorm"] = @(res.hfNorm);
    // Breathing
    out[@"breathingRate"] = @(res.breathingRate);
    // Quality
    NSMutableDictionary* q = [NSMutableDictionary new];
    q[@"totalBeats"] = @(res.quality.totalBeats);
    q[@"rejectedBeats"] = @(res.quality.rejectedBeats);
    q[@"rejectionRate"] = @(res.quality.rejectionRate);
    q[@"goodQuality"] = @(res.quality.goodQuality);
    if (!res.quality.qualityWarning.empty()) {
        q[@"qualityWarning"] = [NSString stringWithUTF8String:res.quality.qualityWarning.c_str()];
    }
    out[@"quality"] = q;
    return out;
}

// Async Promise-based variants to avoid blocking the JS thread
RCT_EXPORT_METHOD(analyzeAsync:(NSArray<NSNumber*>*)signal
                  fs:(nonnull NSNumber*)fs
                  options:(NSDictionary*)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @try {
            id res = [self analyze:signal fs:fs options:options];
            resolve(res);
        } @catch (NSException* e) {
            reject(@"analyze_error", e.reason, nil);
        }
    });
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(analyzeRR:(NSArray<NSNumber*>*)rr
                                    options:(NSDictionary*)options)
{
    std::vector<double> rrms; rrms.reserve(rr.count);
    for (NSNumber* n in rr) rrms.push_back([n doubleValue]);
    heartpy::Options opt = optionsFromNSDictionary(options);
    auto res = heartpy::analyzeRRIntervals(rrms, opt);
    NSMutableDictionary* out = [NSMutableDictionary new];
    out[@"bpm"] = @(res.bpm);
    // Arrays
    NSMutableArray* rrList = [NSMutableArray arrayWithCapacity:res.rrList.size()];
    for (double v : res.rrList) [rrList addObject:@(v)];
    out[@"rrList"] = rrList;
    // Time domain & poincare
    out[@"sdnn"] = @(res.sdnn);
    out[@"rmssd"] = @(res.rmssd);
    out[@"sdsd"] = @(res.sdsd);
    out[@"pnn20"] = @(res.pnn20);
    out[@"pnn50"] = @(res.pnn50);
    out[@"nn20"] = @(res.nn20);
    out[@"nn50"] = @(res.nn50);
    out[@"mad"] = @(res.mad);
    out[@"sd1"] = @(res.sd1);
    out[@"sd2"] = @(res.sd2);
    out[@"sd1sd2Ratio"] = @(res.sd1sd2Ratio);
    out[@"ellipseArea"] = @(res.ellipseArea);
    out[@"breathingRate"] = @(res.breathingRate);
    return out;
}

RCT_EXPORT_METHOD(analyzeRRAsync:(NSArray<NSNumber*>*)rr
                  options:(NSDictionary*)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @try {
            id res = [self analyzeRR:rr options:options];
            resolve(res);
        } @catch (NSException* e) {
            reject(@"analyzeRR_error", e.reason, nil);
        }
    });
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(analyzeSegmentwise:(NSArray<NSNumber*>*)signal
                                      fs:(nonnull NSNumber*)fs
                                      options:(NSDictionary*)options)
{
    std::vector<double> x; x.reserve(signal.count);
    for (NSNumber* n in signal) x.push_back([n doubleValue]);
    heartpy::Options opt = optionsFromNSDictionary(options);
    auto res = heartpy::analyzeSignalSegmentwise(x, [fs doubleValue], opt);
    NSMutableDictionary* out = [NSMutableDictionary new];
    out[@"bpm"] = @(res.bpm);
    out[@"sdnn"] = @(res.sdnn);
    out[@"rmssd"] = @(res.rmssd);
    NSMutableArray* segs = [NSMutableArray new];
    for (const auto& s : res.segments) {
        NSMutableDictionary* d = [NSMutableDictionary new];
        d[@"bpm"] = @(s.bpm);
        d[@"sdnn"] = @(s.sdnn);
        d[@"rmssd"] = @(s.rmssd);
        [segs addObject:d];
    }
    out[@"segments"] = segs;
    return out;
}

RCT_EXPORT_METHOD(analyzeSegmentwiseAsync:(NSArray<NSNumber*>*)signal
                  fs:(nonnull NSNumber*)fs
                  options:(NSDictionary*)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @try {
            id res = [self analyzeSegmentwise:signal fs:fs options:options];
            resolve(res);
        } @catch (NSException* e) {
            reject(@"analyzeSegmentwise_error", e.reason, nil);
        }
    });
}

// Preprocessing exports
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(interpolateClipping:(NSArray<NSNumber*>*)signal
                                      fs:(nonnull NSNumber*)fs
                                      threshold:(nonnull NSNumber*)threshold)
{
    std::vector<double> x; x.reserve(signal.count);
    for (NSNumber* n in signal) x.push_back([n doubleValue]);
    auto y = heartpy::interpolateClipping(x, [fs doubleValue], [threshold doubleValue]);
    NSMutableArray* out = [NSMutableArray arrayWithCapacity:y.size()];
    for (double v : y) [out addObject:@(v)];
    return out;
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(hampelFilter:(NSArray<NSNumber*>*)signal
                                      windowSize:(nonnull NSNumber*)windowSize
                                      threshold:(nonnull NSNumber*)threshold)
{
    std::vector<double> x; x.reserve(signal.count);
    for (NSNumber* n in signal) x.push_back([n doubleValue]);
    auto y = heartpy::hampelFilter(x, [windowSize intValue], [threshold doubleValue]);
    NSMutableArray* out = [NSMutableArray arrayWithCapacity:y.size()];
    for (double v : y) [out addObject:@(v)];
    return out;
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(scaleData:(NSArray<NSNumber*>*)signal
                                   newMin:(nonnull NSNumber*)newMin
                                   newMax:(nonnull NSNumber*)newMax)
{
    std::vector<double> x; x.reserve(signal.count);
    for (NSNumber* n in signal) x.push_back([n doubleValue]);
    auto y = heartpy::scaleData(x, [newMin doubleValue], [newMax doubleValue]);
    NSMutableArray* out = [NSMutableArray arrayWithCapacity:y.size()];
    for (double v : y) [out addObject:@(v)];
    return out;
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(installJSI)
{
	RCTBridge* bridge = self.bridge;
	if (!bridge) return @NO;
	#ifdef RCT_NEW_ARCH_ENABLED
	jsi::Runtime* runtime = (jsi::Runtime*)bridge.runtime;
	#else
	auto cxxBridge = (RCTCxxBridge *)bridge;
	if (!cxxBridge.runtime) return @NO;
	jsi::Runtime& rt = *(jsi::Runtime *)cxxBridge.runtime;
	#endif
	installBinding(rt);
	return @YES;
}

// MARK: - Realtime Streaming (NativeModules P0)

// Create realtime analyzer and return opaque handle (as number)
RCT_EXPORT_METHOD(rtCreate:(double)fs
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        if (fs <= 0.0) { reject(@"HEARTPY_E001", @"Invalid sample rate: must be 1-10000 Hz", nil); return; }
        heartpy::Options opt = optionsFromNSDictionary(options);
        // Validate options centrally
        const char* code = nullptr; std::string msg;
        if (!hp_validate_options(fs, opt, &code, &msg)) {
            NSString* nscode = code ? [NSString stringWithUTF8String:code] : @"HEARTPY_E015";
            NSString* nsmsg = [NSString stringWithUTF8String:msg.c_str()];
            reject(nscode, nsmsg, nil);
            return;
        }
        void* handle = hp_rt_create(fs, &opt);
        if (!handle) { reject(@"HEARTPY_E004", @"hp_rt_create returned null", nil); return; }
        resolve(@((long)handle));
    } @catch (NSException* e) {
        reject(@"HEARTPY_E900", e.reason, nil);
    }
}

// Push a chunk of samples (number[])
RCT_EXPORT_METHOD(rtPush:(nonnull NSNumber*)handle
                  samples:(NSArray<NSNumber*>*)samples
                  timestamp:(nullable NSNumber*)t0
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        if (handle == nil || samples == nil || samples.count == 0) { reject(@"rt_push_invalid_args", @"Invalid handle or empty samples", nil); return; }
        void* h = (void*)[handle longValue];
        const NSUInteger n = samples.count;
        std::vector<float> x; x.reserve(n);
        for (NSNumber* v in samples) x.push_back([v floatValue]);
        double ts0 = t0 ? [t0 doubleValue] : 0.0;
        hp_rt_push(h, x.data(), (size_t)x.size(), ts0);
        resolve(nil);
    } @catch (NSException* e) {
        reject(@"rt_push_exception", e.reason, nil);
    }
}

// Poll for latest metrics; returns object or null
RCT_EXPORT_METHOD(rtPoll:(nonnull NSNumber*)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        if (handle == nil) { reject(@"rt_poll_invalid_args", @"Invalid handle", nil); return; }
        void* h = (void*)[handle longValue];
        heartpy::HeartMetrics res;
        if (!hp_rt_poll(h, &res)) { resolve(nil); return; }

        NSMutableDictionary* out = [NSMutableDictionary new];
        out[@"bpm"] = @(res.bpm);
        // Arrays
        {
            NSMutableArray* ibi = [NSMutableArray arrayWithCapacity:res.ibiMs.size()];
            for (double v : res.ibiMs) [ibi addObject:@(v)];
            out[@"ibiMs"] = ibi;
            NSMutableArray* rr = [NSMutableArray arrayWithCapacity:res.rrList.size()];
            for (double v : res.rrList) [rr addObject:@(v)];
            out[@"rrList"] = rr;
            NSMutableArray* peaks = [NSMutableArray arrayWithCapacity:res.peakList.size()];
            for (int idx : res.peakList) [peaks addObject:@(idx)];
            out[@"peakList"] = peaks;
        }
        // Time domain
        out[@"sdnn"] = @(res.sdnn);
        out[@"rmssd"] = @(res.rmssd);
        out[@"sdsd"] = @(res.sdsd);
        out[@"pnn20"] = @(res.pnn20);
        out[@"pnn50"] = @(res.pnn50);
        out[@"nn20"] = @(res.nn20);
        out[@"nn50"] = @(res.nn50);
        out[@"mad"] = @(res.mad);
        // Poincaré
        out[@"sd1"] = @(res.sd1);
        out[@"sd2"] = @(res.sd2);
        out[@"sd1sd2Ratio"] = @(res.sd1sd2Ratio);
        out[@"ellipseArea"] = @(res.ellipseArea);
        // Frequency domain
        out[@"vlf"] = @(res.vlf);
        out[@"lf"] = @(res.lf);
        out[@"hf"] = @(res.hf);
        out[@"lfhf"] = @(res.lfhf);
        out[@"totalPower"] = @(res.totalPower);
        out[@"lfNorm"] = @(res.lfNorm);
        out[@"hfNorm"] = @(res.hfNorm);
        // Breathing
        out[@"breathingRate"] = @(res.breathingRate);
        // Quality
        {
            NSMutableDictionary* q = [NSMutableDictionary new];
            q[@"totalBeats"] = @(res.quality.totalBeats);
            q[@"rejectedBeats"] = @(res.quality.rejectedBeats);
            q[@"rejectionRate"] = @(res.quality.rejectionRate);
            q[@"goodQuality"] = @(res.quality.goodQuality);
            // Streaming quality fields (if available)
            q[@"snrDb"] = @(res.quality.snrDb);
            q[@"confidence"] = @(res.quality.confidence);
            q[@"f0Hz"] = @(res.quality.f0Hz);
            q[@"maPercActive"] = @(res.quality.maPercActive);
            q[@"doublingFlag"] = @(res.quality.doublingFlag);
            q[@"softDoublingFlag"] = @(res.quality.softDoublingFlag);
            q[@"doublingHintFlag"] = @(res.quality.doublingHintFlag);
            q[@"hardFallbackActive"] = @(res.quality.hardFallbackActive);
            q[@"rrFallbackModeActive"] = @(res.quality.rrFallbackModeActive);
            q[@"refractoryMsActive"] = @(res.quality.refractoryMsActive);
            q[@"minRRBoundMs"] = @(res.quality.minRRBoundMs);
            q[@"pairFrac"] = @(res.quality.pairFrac);
            q[@"rrShortFrac"] = @(res.quality.rrShortFrac);
            q[@"rrLongMs"] = @(res.quality.rrLongMs);
            q[@"pHalfOverFund"] = @(res.quality.pHalfOverFund);
            if (!res.quality.qualityWarning.empty()) {
                q[@"qualityWarning"] = [NSString stringWithUTF8String:res.quality.qualityWarning.c_str()];
            }
            out[@"quality"] = q;
        }
        // Binary segments (if any)
        {
            NSMutableArray* segs = [NSMutableArray arrayWithCapacity:res.binarySegments.size()];
            for (const auto& s : res.binarySegments) {
                NSMutableDictionary* d = [NSMutableDictionary new];
                d[@"index"] = @(s.index);
                d[@"startBeat"] = @(s.startBeat);
                d[@"endBeat"] = @(s.endBeat);
                d[@"totalBeats"] = @(s.totalBeats);
                d[@"rejectedBeats"] = @(s.rejectedBeats);
                d[@"accepted"] = @(s.accepted);
                [segs addObject:d];
            }
            out[@"binarySegments"] = segs;
        }
        resolve(out);
    } @catch (NSException* e) {
        reject(@"rt_poll_exception", e.reason, nil);
    }
}

// Destroy analyzer and release native resources
RCT_EXPORT_METHOD(rtDestroy:(nonnull NSNumber*)handle
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        if (handle == nil) { reject(@"rt_destroy_invalid_args", @"Invalid handle", nil); return; }
        void* h = (void*)[handle longValue];
        hp_rt_destroy(h);
        resolve(nil);
    } @catch (NSException* e) {
        reject(@"rt_destroy_exception", e.reason, nil);
    }
}

@end


