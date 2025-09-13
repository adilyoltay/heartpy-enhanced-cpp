#!/bin/bash

# HeartPy Rollback Script
set -e

ROOT_DIR="/Users/adilyoltay/Desktop/heartpy"
cd "$ROOT_DIR"

# Find latest backup
BACKUP_DIR=$(ls -d backup-* 2>/dev/null | tail -1)

if [ -z "$BACKUP_DIR" ]; then
    echo "❌ No backup directory found!"
    echo "Available backups:"
    ls -la backup-* 2>/dev/null || echo "   (none)"
    exit 1
fi

echo "🔄 HeartPy Rollback from: $BACKUP_DIR"

# Verify backup contents
if [ ! -f "$BACKUP_DIR/heartpy_stream.cpp" ]; then
    echo "❌ Backup incomplete! Missing files in $BACKUP_DIR"
    exit 1
fi

# Show what will be restored
echo "📋 Files to restore:"
ls -la "$BACKUP_DIR"

read -p "🤔 Proceed with rollback? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Rollback cancelled."
    exit 1
fi

# Perform rollback
echo "⏪ Restoring files..."
cp "$BACKUP_DIR"/* cpp/

echo "✅ Rollback completed!"
echo "🔍 Restored file sizes:"
echo "  cpp/heartpy_stream.cpp: $(wc -l < cpp/heartpy_stream.cpp) lines"

# Test build
echo "🏗️ Testing build after rollback..."
cd react-native-heartpy
if npm run build; then
    echo "✅ Rollback successful - build test passed!"
else
    echo "⚠️ Build failed after rollback - manual intervention needed"
fi
