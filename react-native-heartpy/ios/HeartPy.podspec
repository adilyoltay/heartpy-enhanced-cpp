Pod::Spec.new do |s|
  s.name         = 'HeartPy'
  s.version      = '0.1.0'
  s.summary      = 'React Native bindings for HeartPy-like C++ core'
  s.license      = { :type => 'MIT' }
  s.authors      = { 'you' => 'you@example.com' }
  s.homepage     = 'https://example.com'
  s.platforms    = { :ios => '12.0' }
  s.source       = { :path => '.' }
  s.source_files = 'HeartPyModuleSimple.{h,mm}'
  s.public_header_files = 'HeartPyModuleSimple.h'
  s.requires_arc = true
  s.dependency 'React-Core'
end


