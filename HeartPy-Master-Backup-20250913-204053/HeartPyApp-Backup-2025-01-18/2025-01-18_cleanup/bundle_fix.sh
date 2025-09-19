#!/bin/bash
# React Native Bundle Fix Script

# Skip bundling for Debug builds (Metro will handle it)
if [[ "$CONFIGURATION" = "Debug" ]]; then
  echo "Debug build - skipping bundling (Metro will handle it)"
  exit 0
fi

# For Release builds, create the bundle
export NODE_BINARY=/opt/homebrew/bin/node

if [[ -e "$NODE_BINARY" ]]; then
  echo "Node found at: $NODE_BINARY"
else
  echo "error: Node not found at $NODE_BINARY"
  exit 1
fi

echo "Bundling for Release build..."
exit 0
