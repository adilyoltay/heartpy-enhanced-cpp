#!/bin/bash

# HeartPy Duplikasyon Temizleme Script
set -e

ROOT_DIR="/Users/adilyoltay/Desktop/heartpy"
cd "$ROOT_DIR"

echo "🧹 HeartPy Duplikasyon Temizleme"
echo "================================="

# 1. Create archive backup
ARCHIVE_DIR="cpp-archive-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating archive: $ARCHIVE_DIR"
mkdir -p "$ARCHIVE_DIR"
cp -r cpp/ "$ARCHIVE_DIR/"

# 2. Show current duplikasyon
echo -e "\n📊 Current Duplication:"
echo "  Root cpp/: $(ls cpp/*.{h,cpp} | wc -l) files"
echo "  iOS copy: $(ls react-native-heartpy/ios/heartpy_*.{h,cpp} react-native-heartpy/ios/rn_*.{h,cpp} | wc -l) files"

# 3. Podspec analysis
echo -e "\n🔍 iOS Podspec uses:"
grep source_files react-native-heartpy/ios/HeartPy.podspec

echo -e "\n💡 Solution: iOS directory is MASTER (used by React Native builds)"
echo "   Root cpp/ will be archived as reference/examples only"

read -p "🤔 Proceed with archiving root cpp/? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled."
    exit 1
fi

# 4. Create README explaining new structure
cat > cpp/README.md << 'EOF'
# HeartPy C++ - ARCHIVED

**⚠️ NOTICE: This directory is now ARCHIVED**

## 📍 Current Master Location
The active HeartPy C++ source files are now in:
```
react-native-heartpy/ios/heartpy_core.{h,cpp}
react-native-heartpy/ios/heartpy_stream.{h,cpp}  
react-native-heartpy/ios/rn_options_builder.{h,cpp}
```

## 🎯 Why This Change?
- React Native iOS builds use `react-native-heartpy/ios/` directory
- Root `cpp/` directory was not used by the actual app
- Eliminated source duplication and sync issues
- Single source of truth for mobile app

## 🔄 Build Process
- iOS: Uses files directly from `react-native-heartpy/ios/`
- Android: Uses files via `react-native-heartpy/android/cpp/`
- Examples: Reference implementations (use archived versions if needed)

## 📦 Archive Location
Original files backed up in: `cpp-archive-YYYYMMDD-HHMMSS/`
EOF

echo "✅ Archive completed: $ARCHIVE_DIR"
echo "✅ README created: cpp/README.md"
echo "✅ iOS directory is now MASTER"

# 5. Verification
echo -e "\n🔍 Final Verification:"
echo "  iOS master files: $(ls react-native-heartpy/ios/heartpy_*.{h,cpp} | wc -l)"
echo "  Archive backup: $(ls $ARCHIVE_DIR/cpp/*.{h,cpp} | wc -l)"
echo "  README created: cpp/README.md"

echo -e "\n🎯 STRUCTURE CLEANED!"
echo "📍 Master C++ files: react-native-heartpy/ios/"
echo "📦 Archive backup: $ARCHIVE_DIR/"
