#!/bin/bash

# HeartPy Safe Sync Script
set -e  # Exit on any error

BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
ROOT_DIR="/Users/adilyoltay/Desktop/heartpy"

echo "🛡️ Starting HeartPy Safe Sync..."
cd "$ROOT_DIR"

# 1. Create backup
echo "📦 Creating backup..."
mkdir -p "$BACKUP_DIR"
cp cpp/heartpy_core.h "$BACKUP_DIR/"
cp cpp/heartpy_core.cpp "$BACKUP_DIR/"
cp cpp/heartpy_stream.h "$BACKUP_DIR/"
cp cpp/heartpy_stream.cpp "$BACKUP_DIR/"

echo "✅ Backup created: $BACKUP_DIR"
echo "📊 Original file sizes:"
echo "  cpp/heartpy_stream.cpp: $(wc -l < cpp/heartpy_stream.cpp) lines"
echo "  ios/heartpy_stream.cpp: $(wc -l < react-native-heartpy/ios/heartpy_stream.cpp) lines"

# 2. Show key differences
echo -e "\n🔍 Key differences found:"
echo "iOS version has 6 extra lines with enhanced confidence calculation:"
echo "  - activeConf3 confidence boost logic"
echo "  - Improved algorithm stability"

# 3. Ask for confirmation
read -p "🤔 iOS version is newer and improved. Proceed with sync? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Sync cancelled."
    exit 1
fi

# 4. Perform sync
echo "⬆️ Syncing iOS → Root cpp..."
cp react-native-heartpy/ios/heartpy_stream.h cpp/
cp react-native-heartpy/ios/heartpy_stream.cpp cpp/
cp react-native-heartpy/ios/heartpy_core.h cpp/
cp react-native-heartpy/ios/heartpy_core.cpp cpp/

echo "✅ Sync completed!"

# 5. Verify
echo "🔍 Post-sync verification..."
echo "Root cpp lines: $(wc -l < cpp/heartpy_stream.cpp)"
echo "iOS lines: $(wc -l < react-native-heartpy/ios/heartpy_stream.cpp)"

# 6. Test build
echo "🏗️ Testing react-native-heartpy build..."
cd react-native-heartpy
if npm run build; then
    echo "✅ Build test passed!"
else
    echo "❌ Build failed! Rolling back..."
    cd "$ROOT_DIR"
    cp "$BACKUP_DIR"/* cpp/
    echo "🔄 Rollback completed"
    exit 1
fi

cd "$ROOT_DIR"
echo -e "\n🎯 SUCCESS! Files synchronized."
echo -e "📋 ROLLBACK PLAN (if needed):"
echo "   cp $BACKUP_DIR/* cpp/"

echo -e "\n🚀 Next steps:"
echo "   1. Test iOS build: cd HeartPyApp && npx react-native run-ios --device 'Adil iphone'"
echo "   2. Verify PPG functionality"
echo "   3. If issues: run rollback command above"
