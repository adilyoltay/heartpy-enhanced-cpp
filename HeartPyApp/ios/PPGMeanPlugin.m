#import <Foundation/Foundation.h>
#import "FrameProcessorPlugin.h"
#import <CoreVideo/CoreVideo.h>
#include <math.h>

@interface PPGMeanPlugin : FrameProcessorPlugin
@end

@implementation PPGMeanPlugin

- (id)callback:(Frame *)frame withArguments:(NSDictionary *)arguments {
  // ROI fraction (0..1)
  NSNumber* roiNum = arguments[@"roi"];
  double roiIn = roiNum != nil ? roiNum.doubleValue : 0.4;
  double roi = fmax(0.2, fmin(0.6, roiIn));

  // Channel: "green" | "red" | "luma" (default: green for rPPG SNR)
  NSString* channel = [arguments objectForKey:@"channel"];
  if (![channel isKindOfClass:[NSString class]] || channel.length == 0) {
    channel = @"green";
  }

  // Mode: "mean" | "chrom" | "pos" (pos aliases chrom for v1)
  NSString* mode = [arguments objectForKey:@"mode"];
  if (![mode isKindOfClass:[NSString class]] || mode.length == 0) mode = @"mean";
  BOOL useCHROM = ([mode isEqualToString:@"chrom"] || [mode isEqualToString:@"pos"]);

  // Grid size for multi-ROI (1..3)
  NSNumber* gridNum = arguments[@"grid"];
  int grid = gridNum != nil ? [gridNum intValue] : 1;
  if (grid < 1) grid = 1; if (grid > 3) grid = 3;

  // Sampling step (stride) for performance
  NSNumber* stepNum = arguments[@"step"];
  int stepIn = stepNum != nil ? stepNum.intValue : 2;
  int step = stepIn < 1 ? 1 : (stepIn > 8 ? 8 : stepIn);

  CMSampleBufferRef buffer = frame.buffer;
  CVImageBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(buffer);
  if (pixelBuffer == nil) return @(NAN);

  CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  OSType type = CVPixelBufferGetPixelFormatType(pixelBuffer);
  size_t width = CVPixelBufferGetWidth(pixelBuffer);
  size_t height = CVPixelBufferGetHeight(pixelBuffer);

  // Compute centered ROI
  size_t roiW = MAX((size_t)1, (size_t)(width * roi));
  size_t roiH = MAX((size_t)1, (size_t)(height * roi));
  // Area guard: ensure ROI covers at least 10% of frame
  double minArea = 0.1 * (double)width * (double)height;
  if ((double)roiW * (double)roiH < minArea) {
    roi = 0.4;
    roiW = MAX((size_t)1, (size_t)(width * roi));
    roiH = MAX((size_t)1, (size_t)(height * roi));
  }
  size_t startX = (width > roiW) ? (width - roiW) / 2 : 0;
  size_t startY = (height > roiH) ? (height - roiH) / 2 : 0;

  double outSample = NAN;
  double outConfidence = NAN;

  // Multi-ROI aggregation with simple exposure-based weighting
  double weightedSum = 0.0;
  double weightTotal = 0.0;
  double confAccum = 0.0;

  if (type == kCVPixelFormatType_32BGRA) {
    uint8_t* base = (uint8_t*)CVPixelBufferGetBaseAddress(pixelBuffer);
    const size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
    const size_t xStep = (size_t)step, yStep = (size_t)step;
    size_t patchW = MAX((size_t)1, roiW / (size_t)grid);
    size_t patchH = MAX((size_t)1, roiH / (size_t)grid);
    for (int gy = 0; gy < grid; ++gy) {
      for (int gx = 0; gx < grid; ++gx) {
        size_t px0 = startX + (size_t)gx * patchW;
        size_t py0 = startY + (size_t)gy * patchH;
        size_t px1 = (gx == grid - 1) ? (startX + roiW) : (px0 + patchW);
        size_t py1 = (gy == grid - 1) ? (startY + roiH) : (py0 + patchH);
        unsigned long long sumR = 0, sumG = 0, sumB = 0; unsigned long long cnt = 0;
        for (size_t y = py0; y < py1; y += yStep) {
          uint8_t* row = base + y * bytesPerRow;
          for (size_t x = px0; x < px1; x += xStep) {
            uint8_t b = row[x * 4 + 0];
            uint8_t g = row[x * 4 + 1];
            uint8_t r = row[x * 4 + 2];
            sumR += r; sumG += g; sumB += b; cnt++;
          }
        }
        if (cnt == 0) continue;
        double Rm = (double)sumR / (double)cnt; double Gm = (double)sumG / (double)cnt; double Bm = (double)sumB / (double)cnt;
        double Ym = 0.114 * Bm + 0.587 * Gm + 0.299 * Rm;
        double value = 0.0;
        if (useCHROM) {
          double X = 3.0 * Rm - 2.0 * Gm;
          double Yc = 1.5 * Rm + 1.0 * Gm - 1.5 * Bm;
          double S = X - 1.0 * Yc; // alpha=1.0
          value = 128.0 + 0.5 * S;
        } else {
          if ([channel isEqualToString:@"red"]) value = Rm; else if ([channel isEqualToString:@"luma"]) value = Ym; else value = Gm;
        }
        if (value < 0.0) value = 0.0; if (value > 255.0) value = 255.0;
        // exposure score from luma
        double expScore = 1.0;
        if (Ym < 15.0) expScore = fmax(0.0, Ym / 15.0);
        else if (Ym > 240.0) expScore = fmax(0.0, (255.0 - Ym) / 15.0);
        double ampScore = 0.0; // no temporal history; keep small proxy
        if (useCHROM) {
          double Sabs = fabs((3.0 * Rm - 2.0 * Gm) - (1.5 * Rm + 1.0 * Gm - 1.5 * Bm));
          ampScore = fmin(1.0, Sabs / 50.0);
        }
        double conf = fmin(1.0, fmax(0.0, 0.7 * expScore + 0.3 * ampScore));
        double w = fmax(1e-6, expScore);
        weightedSum += w * value; weightTotal += w; confAccum += w * conf;
      }
    }
  } else {
    // NV12 Y + interleaved CbCr
    const size_t yPlane = 0;
    const size_t uvPlane = 1;
    const size_t yRowStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, yPlane);
    const size_t uvRowStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, uvPlane);
    uint8_t* yBase = (uint8_t*)CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, yPlane);
    uint8_t* uvBase = (uint8_t*)CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, uvPlane);
    const size_t xStep = (size_t)step, yStep = (size_t)step;
    size_t patchW = MAX((size_t)1, roiW / (size_t)grid);
    size_t patchH = MAX((size_t)1, roiH / (size_t)grid);
    for (int gy = 0; gy < grid; ++gy) {
      for (int gx = 0; gx < grid; ++gx) {
        size_t px0 = startX + (size_t)gx * patchW;
        size_t py0 = startY + (size_t)gy * patchH;
        size_t px1 = (gx == grid - 1) ? (startX + roiW) : (px0 + patchW);
        size_t py1 = (gy == grid - 1) ? (startY + roiH) : (py0 + patchH);
        unsigned long long sumR = 0, sumG = 0, sumB = 0, sumY = 0; unsigned long long cnt = 0;
        for (size_t y = py0; y < py1; y += yStep) {
          uint8_t* yRow = yBase + y * yRowStride;
          size_t uvY = y >> 1; uint8_t* uvRow = uvBase + uvY * uvRowStride;
          for (size_t x = px0; x < px1; x += xStep) {
            size_t yIdx = x; double Yv = (double)(yRow[yIdx] & 0xFF);
            size_t uvX = x >> 1; size_t uvIdx = uvX * 2; uint8_t Cb = uvRow[uvIdx + 0]; uint8_t Cr = uvRow[uvIdx + 1];
            double cb = (double)Cb - 128.0; double cr = (double)Cr - 128.0;
            double Rv = Yv + 1.402 * cr; double Gv = Yv - 0.344 * cb - 0.714 * cr; double Bv = Yv + 1.772 * cb;
            if (Rv < 0.0) Rv = 0.0; if (Rv > 255.0) Rv = 255.0;
            if (Gv < 0.0) Gv = 0.0; if (Gv > 255.0) Gv = 255.0;
            if (Bv < 0.0) Bv = 0.0; if (Bv > 255.0) Bv = 255.0;
            sumR += (unsigned long long)Rv; sumG += (unsigned long long)Gv; sumB += (unsigned long long)Bv; sumY += (unsigned long long)Yv; cnt++;
          }
        }
        if (cnt == 0) continue;
        double Rm = (double)sumR / (double)cnt; double Gm = (double)sumG / (double)cnt; double Bm = (double)sumB / (double)cnt; double Ym = (double)sumY / (double)cnt;
        double value = 0.0;
        if (useCHROM) {
          double X = 3.0 * Rm - 2.0 * Gm; double Yc = 1.5 * Rm + 1.0 * Gm - 1.5 * Bm; double S = X - 1.0 * Yc;
          value = 128.0 + 0.5 * S;
        } else {
          if ([channel isEqualToString:@"red"]) value = Rm; else if ([channel isEqualToString:@"luma"]) value = Ym; else value = Gm;
        }
        if (value < 0.0) value = 0.0; if (value > 255.0) value = 255.0;
        double expScore = 1.0; if (Ym < 15.0) expScore = fmax(0.0, Ym / 15.0); else if (Ym > 240.0) expScore = fmax(0.0, (255.0 - Ym) / 15.0);
        double ampScore = 0.0; if (useCHROM) { double Sabs = fabs((3.0 * Rm - 2.0 * Gm) - (1.5 * Rm + 1.0 * Gm - 1.5 * Bm)); ampScore = fmin(1.0, Sabs / 50.0);} 
        double conf = fmin(1.0, fmax(0.0, 0.7 * expScore + 0.3 * ampScore));
        double w = fmax(1e-6, expScore);
        weightedSum += w * value; weightTotal += w; confAccum += w * conf;
      }
    }
  }

  double mean = (weightTotal > 0.0) ? (weightedSum / weightTotal) : NAN;
  outSample = mean;
  outConfidence = (weightTotal > 0.0) ? (confAccum / weightTotal) : NAN;

  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  if (!isfinite(outSample)) outSample = NAN;
  
  // Post native notification so HeartPyModule can collect real samples without JS bridge
  @try {
    static int notificationCount = 0;
    notificationCount++;
    
    NSDictionary* userInfo = @{ @"value": @(outSample),
                                @"timestamp": @([[NSDate date] timeIntervalSince1970]),
                                @"confidence": @(outConfidence) };
    [[NSNotificationCenter defaultCenter] postNotificationName:@"HeartPyPPGSample"
                                                        object:nil
                                                      userInfo:userInfo];
    
    // Debug log periodically
    if (notificationCount % 120 == 0) {
      NSLog(@"📸 PPGMeanPlugin posted notification #%d with value: %.1f", notificationCount, mean);
    }
  } @catch (__unused id e) {}
  return @(outSample);
}

VISION_EXPORT_FRAME_PROCESSOR(PPGMeanPlugin, ppgMean)

@end
