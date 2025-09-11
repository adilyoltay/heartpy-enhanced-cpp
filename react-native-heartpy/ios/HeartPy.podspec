Pod::Spec.new do |s|
  s.name         = 'HeartPy'
  s.version      = '0.1.0'
  s.summary      = 'React Native bindings for HeartPy-like C++ core'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'you' => 'you@example.com' }
  s.homepage     = 'https://example.com'
  s.platforms    = { :ios => '12.0' }
  s.source       = { :path => '.' }
  s.source_files = 'ios/**/*.{mm,m,h,cpp,hpp,cc}', 'ios/*.{mm,m,h}', '../cpp/*.{h,hpp,cpp,cc}', '../third_party/kissfft/*.{c,h}'
  s.public_header_files = 'ios/*.h'
  s.requires_arc = true
  s.dependency 'React-Core'
  # Enable KissFFT backend on iOS for Welch PSD
  s.pod_target_xcconfig = { 'GCC_PREPROCESSOR_DEFINITIONS' => 'USE_KISSFFT=1' }
end


