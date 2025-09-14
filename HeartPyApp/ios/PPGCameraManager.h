#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface PPGCameraManager : RCTEventEmitter <RCTBridgeModule>

@property (nonatomic, strong) AVCaptureDevice *captureDevice;

// Camera lock methods
- (void)lockCameraSettings:(NSDictionary *)settings resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)unlockCameraSettings:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)setTorchLevel:(NSNumber *)level resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)getCameraCapabilities:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;

@end
