#!/bin/bash

# HeartPy Symlink Çözümü - Duplikasyonu symlink ile çöz
set -e

ROOT_DIR="/Users/adilyoltay/Desktop/heartpy"
cd "$ROOT_DIR"

echo "🔗 HeartPy Symlink Solution"
echo "==========================="

# 1. Backup current state
BACKUP_DIR="pre-symlink-backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp react-native-heartpy/ios/heartpy_*.{h,cpp} "$BACKUP_DIR/"
cp react-native-heartpy/ios/rn_*.{h,cpp} "$BACKUP_DIR/"

# 2. Show current duplication
echo -e "\n📊 BEFORE - Duplication Status:"
echo "  Root cpp files:"
ls -la cpp/heartpy_*.{h,cpp} | awk '{print "    " $9 " (" $5 " bytes)"}'
echo "  iOS copy files:"  
ls -la react-native-heartpy/ios/heartpy_*.{h,cpp} | awk '{print "    " $9 " (" $5 " bytes)"}'

echo -e "\n🎯 Solution: iOS will symlink to cpp/ (master)"

read -p "🤔 Proceed with symlink solution? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cancelled."
    exit 1
fi

# 3. Remove iOS copies and create symlinks
echo "🗑️ Removing iOS copies..."
cd react-native-heartpy/ios/
rm -f heartpy_core.h heartpy_core.cpp heartpy_stream.h heartpy_stream.cpp

echo "🔗 Creating symlinks to master files..."
ln -s ../../cpp/heartpy_core.h .
ln -s ../../cpp/heartpy_core.cpp .
ln -s ../../cpp/heartpy_stream.h .
ln -s ../../cpp/heartpy_stream.cpp .

# 4. Verify symlinks
echo -e "\n✅ Verification:"
ls -la heartpy_*.{h,cpp}

cd "$ROOT_DIR"

# 5. Test build
echo -e "\n🏗️ Testing build with symlinks..."
cd react-native-heartpy
if npm run build; then
    echo "✅ Build successful with symlinks!"
else
    echo "❌ Build failed! Rolling back..."
    cd ios/
    rm -f heartpy_*.{h,cpp}
    cp "$ROOT_DIR/$BACKUP_DIR"/* .
    echo "🔄 Rollback completed"
    exit 1
fi

cd "$ROOT_DIR"
echo -e "\n🎯 SUCCESS! Symlink solution implemented."
echo "📍 Master files: cpp/ directory"
echo "🔗 iOS references: symlinks to master"
echo "📦 Rollback: cp $BACKUP_DIR/* react-native-heartpy/ios/"
