#!/bin/bash
# Quick script restore utility

BACKUP_DIR=$(dirname "$0")
TARGET_DIR="/Users/adilyoltay/Desktop/heartpy"

echo "🔧 Restoring scripts to: $TARGET_DIR"
cp "$BACKUP_DIR"/scripts/*.sh "$TARGET_DIR/"
chmod +x "$TARGET_DIR"/*.sh
echo "✅ Scripts restored and made executable"
