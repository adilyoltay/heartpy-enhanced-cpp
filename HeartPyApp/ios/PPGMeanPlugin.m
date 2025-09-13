#import <Foundation/Foundation.h>
#import "FrameProcessorPlugin.h"
#import <CoreVideo/CoreVideo.h>

@interface PPGMeanPlugin : FrameProcessorPlugin
@end

@implementation PPGMeanPlugin

- (id)callback:(Frame *)frame withArguments:(NSDictionary *)arguments {
  // ROI fraction (0..1). Default 0.5 (center half of width/height)
  NSNumber* roiNum = arguments[@"roi"];
  double roiIn = roiNum != nil ? roiNum.doubleValue : 0.4;
  double roi = fmax(0.2, fmin(0.6, roiIn));

  CMSampleBufferRef buffer = frame.buffer;
  CVImageBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(buffer);
  if (pixelBuffer == nil) return @(0.0);

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
    // Fast-path: average red channel in BGRA
    uint8_t* base = (uint8_t*)CVPixelBufferGetBaseAddress(pixelBuffer);
    const size_t bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer);
    // Sample every 2 pixels for speed
    const size_t xStep = 2, yStep = 2;
    for (size_t y = startY; y < startY + roiH; y += yStep) {
      uint8_t* row = base + y * bytesPerRow;
      for (size_t x = startX; x < startX + roiW; x += xStep) {
        uint8_t b = row[x * 4 + 0];
        uint8_t g = row[x * 4 + 1];
        uint8_t r = row[x * 4 + 2];
        (void)b; (void)g; // unused
        sum += r;
        count++;
      }
    }
    mean = count > 0 ? (double)sum / (double)count : 0.0;
  } else {
    // Assume YUV: use plane 0 (luma)
    const size_t planeIndex = 0;
    const size_t bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, planeIndex);
    uint8_t* base = (uint8_t*)CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, planeIndex);
    // Sample every 2 pixels for speed
    const size_t xStep = 2, yStep = 2;
    for (size_t y = startY; y < startY + roiH; y += yStep) {
      uint8_t* row = base + y * bytesPerRow;
      for (size_t x = startX; x < startX + roiW; x += xStep) {
        uint8_t Y = row[x];
        sum += Y;
        count++;
      }
    }
    mean = count > 0 ? (double)sum / (double)count : 0.0;
  }

  CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
  return @(mean);
}

VISION_EXPORT_FRAME_PROCESSOR(PPGMeanPlugin, ppgMean)

@end
