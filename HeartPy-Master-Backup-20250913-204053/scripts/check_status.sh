#!/bin/bash

# HeartPy Status Checker
ROOT_DIR="/Users/adilyoltay/Desktop/heartpy"
cd "$ROOT_DIR"

echo "📊 HeartPy File Status Report"
echo "================================"

# Check file sizes
echo -e "\n📏 File Sizes:"
echo "Root cpp/heartpy_stream.cpp:     $(wc -l < cpp/heartpy_stream.cpp) lines"
echo "iOS heartpy_stream.cpp:          $(wc -l < react-native-heartpy/ios/heartpy_stream.cpp) lines"
echo "Root cpp/heartpy_stream.h:       $(wc -l < cpp/heartpy_stream.h) lines" 
echo "iOS heartpy_stream.h:            $(wc -l < react-native-heartpy/ios/heartpy_stream.h) lines"

# Check sync status
ROOT_CPP_LINES=$(wc -l < cpp/heartpy_stream.cpp)
IOS_CPP_LINES=$(wc -l < react-native-heartpy/ios/heartpy_stream.cpp)

echo -e "\n🔍 Sync Status:"
if [ "$ROOT_CPP_LINES" -eq "$IOS_CPP_LINES" ]; then
    echo "✅ Files are synchronized ($ROOT_CPP_LINES lines each)"
else
    echo "⚠️  Files are NOT synchronized"
    echo "   Difference: $((IOS_CPP_LINES - ROOT_CPP_LINES)) lines"
    if [ "$IOS_CPP_LINES" -gt "$ROOT_CPP_LINES" ]; then
        echo "   iOS version is newer"
    else
        echo "   Root version is newer"
    fi
fi

# Check backups
echo -e "\n💾 Available Backups:"
if ls backup-* 1> /dev/null 2>&1; then
    ls -la backup-*/
else
    echo "   (no backups found)"
fi

# Check build status
echo -e "\n🏗️ Build Status:"
cd react-native-heartpy
if npm run build &>/dev/null; then
    echo "✅ react-native-heartpy builds successfully"
else
    echo "❌ react-native-heartpy build fails"
fi

cd "$ROOT_DIR"
echo -e "\n🎯 Ready for operations!"
