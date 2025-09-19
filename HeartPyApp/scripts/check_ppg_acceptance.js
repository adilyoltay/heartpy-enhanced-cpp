#!/usr/bin/env node

/**
 * PPG Acceptance Test Suite
 * Validates log output against acceptance criteria
 * 
 * Usage: node check_ppg_acceptance.js <log_file_path>
 * Exit codes: 0 = all tests pass, 1 = any test fails
 */

const fs = require('fs');

class PPGAcceptanceChecker {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
    this.logContent = '';
    this.results = { passed: 0, failed: 0, tests: [] };
  }

  loadLogFile() {
    try {
      this.logContent = fs.readFileSync(this.logFilePath, 'utf8');
      console.log(`📄 Loaded log file: ${this.logFilePath}`);
    } catch (error) {
      console.error(`❌ Failed to load log file: ${error.message}`);
      process.exit(1);
    }
  }

  test(name, condition, description) {
    const passed = condition();
    this.results.tests.push({ name, passed, description });
    if (passed) {
      this.results.passed++;
      console.log(`✅ ${name}: ${description}`);
    } else {
      this.results.failed++;
      console.log(`❌ ${name}: ${description}`);
    }
  }

  runAllTests() {
    console.log('🚀 Starting PPG Acceptance Test Suite...\n');
    this.loadLogFile();
    
    // Sample Stream Flow Tests
    console.log('\n🔍 Testing Sample Stream Flow...');
    this.test('Valid samples received', () => {
      const matches = this.logContent.match(/\[PPGCamera\] Received valid sample from NativeModules/g);
      return matches && matches.length >= 10;
    }, 'At least 10 valid samples received');
    
    this.test('HeartPy pushWithTimestamps called', () => {
      const matches = this.logContent.match(/\[HeartPyWrapper\] pushWithTimestamps/g);
      return matches && matches.length >= 5;
    }, 'HeartPy pushWithTimestamps called at least 5 times');
    
    // HeartPy Warm-up Tests
    console.log('\n🔍 Testing HeartPy Warm-up...');
    this.test('Native confidence preserved', () => {
      const matches = this.logContent.match(/\[HeartPyWrapper\] Native metrics:.*"nativeConfidence": 0/g);
      return matches && matches.length >= 3;
    }, 'Native confidence = 0 preserved during warm-up');
    
    this.test('BPM calculation started', () => {
      const matches = this.logContent.match(/"bpm": \d+\.\d+/g);
      return matches && matches.length >= 2;
    }, 'BPM values calculated');
    
    // Peak Filtering Tests
    console.log('\n🔍 Testing Peak Filtering...');
    this.test('Peak filtering logs present', () => {
      const matches = this.logContent.match(/\[HeartPyWrapper\] Peak list filtering \(real buffer\)/g);
      return matches && matches.length >= 2;
    }, 'Peak filtering logs present');
    
    // UI Haptic Tests
    console.log('\n🔍 Testing UI Haptic Feedback...');
    this.test('Haptic feedback logic', () => {
      const matches = this.logContent.match(/💓 Haptic disabled - BPM unreliable/g);
      return matches && matches.length >= 1;
    }, 'Haptic feedback logic working');
    
    // Error Handling Tests
    console.log('\n🔍 Testing Error Handling...');
    this.test('No critical errors', () => {
      const matches = this.logContent.match(/ERROR|CRITICAL|FATAL/g);
      return !matches || matches.length === 0;
    }, 'No critical errors in log');
    
    this.printSummary();
    process.exit(this.results.failed > 0 ? 1 : 0);
  }

  printSummary() {
    console.log('\n📊 Test Summary:');
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    
    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.tests
        .filter(test => !test.passed)
        .forEach(test => console.log(`   - ${test.name}`));
    }
    
    console.log(`\n${this.results.failed === 0 ? '🎉 All tests passed!' : '⚠️  Some tests failed.'}`);
  }
}

// Main execution
if (require.main === module) {
  const logFilePath = process.argv[2];
  
  if (!logFilePath) {
    console.error('❌ Usage: node check_ppg_acceptance.js <log_file_path>');
    process.exit(1);
  }
  
  const checker = new PPGAcceptanceChecker(logFilePath);
  checker.runAllTests();
}

module.exports = PPGAcceptanceChecker;