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

  double mean = 0.0;
  unsigned long long sum = 0;
  unsigned long long count = 0;

  if (type == kCVPixelFormatType_32BGRA) {
    // BGRA fast path: choose channel directly; apply stride
    uint8_t* base = (uint8_t*)CVPixelBufferGetBaseAddress(pixelBuffer);
    const size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
    const size_t xStep = (size_t)step, yStep = (size_t)step;
    for (size_t y = startY; y < startY + roiH; y += yStep) {
      uint8_t* row = base + y * bytesPerRow;
      for (size_t x = startX; x < startX + roiW; x += xStep) {
        uint8_t b = row[x * 4 + 0];
        uint8_t g = row[x * 4 + 1];
        uint8_t r = row[x * 4 + 2];
        if ([channel isEqualToString:@"red"]) {
          sum += r;
        } else if ([channel isEqualToString:@"luma"]) {
          // Luma approximation from RGB
          double Y = 0.114 * (double)b + 0.587 * (double)g + 0.299 * (double)r;
          sum += (unsigned long long)llround(fmax(0.0, fmin(255.0, Y)));
        } else {
          // default green
          sum += g;
        }
        count++;
      }
    }
    mean = count > 0 ? (double)sum / (double)count : NAN;
  } else {
    // Assume 420f: plane 0 (Y), plane 1 (CbCr interleaved)
    const size_t yPlane = 0;
    const size_t uvPlane = 1;
    const size_t yRowStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, yPlane);
    const size_t uvRowStride = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, uvPlane);
    uint8_t* yBase = (uint8_t*)CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, yPlane);
    uint8_t* uvBase = (uint8_t*)CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, uvPlane);

    const size_t xStep = (size_t)step, yStep = (size_t)step;
    for (size_t y = startY; y < startY + roiH; y += yStep) {
      uint8_t* yRow = yBase + y * yRowStride;
      size_t uvY = y >> 1; // half resolution
      uint8_t* uvRow = uvBase + uvY * uvRowStride;
      for (size_t x = startX; x < startX + roiW; x += xStep) {
        size_t yIdx = x; // pixelStride assumed 1 for plane 0
        double Y = (double)(yRow[yIdx] & 0xFF);
        if ([channel isEqualToString:@"luma"]) {
          sum += (unsigned long long)llround(Y);
          count++;
          continue;
        }
        size_t uvX = x >> 1; // half resolution
        size_t uvIdx = uvX * 2; // NV12: CbCr
        uint8_t Cb = uvRow[uvIdx + 0];
        uint8_t Cr = uvRow[uvIdx + 1];
        double cb = (double)Cb - 128.0;
        double cr = (double)Cr - 128.0;
        double v = 0.0;
        if ([channel isEqualToString:@"red"]) {
          // R ≈ Y + 1.402 * (Cr-128)
          v = Y + 1.402 * cr;
        } else {
          // green: G ≈ Y − 0.344*(Cb-128) − 0.714*(Cr-128)
          v = Y - 0.344 * cb - 0.714 * cr;
        }
        if (v < 0.0) v = 0.0; if (v > 255.0) v = 255.0;
        sum += (unsigned long long)llround(v);
        count++;
      }
    }
    mean = count > 0 ? (double)sum / (double)count : NAN;
  }

  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  if (!isfinite(mean)) mean = NAN;
  
  // Post native notification so HeartPyModule can collect real samples without JS bridge
  @try {
    static int notificationCount = 0;
    notificationCount++;
    
    NSDictionary* userInfo = @{ @"value": @(mean),
                                @"timestamp": @([[NSDate date] timeIntervalSince1970]) };
    [[NSNotificationCenter defaultCenter] postNotificationName:@"HeartPyPPGSample"
                                                        object:nil
                                                      userInfo:userInfo];
    
    // Debug log periodically
    if (notificationCount % 120 == 0) {
      NSLog(@"📸 PPGMeanPlugin posted notification #%d with value: %.1f", notificationCount, mean);
    }
  } @catch (__unused id e) {}
  return @(mean);
}

VISION_EXPORT_FRAME_PROCESSOR(PPGMeanPlugin, ppgMean)

@end
