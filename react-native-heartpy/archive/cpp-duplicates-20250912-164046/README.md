# Archived C++ Files - Duplicate Cleanup

**Date:** December 12, 2024  
**Reason:** Duplicate file cleanup for React Native JSI implementation

## What was archived:
- `heartpy_core.cpp` (59,779 bytes, outdated copy)
- `heartpy_core.h` (7,130 bytes, outdated copy)

## Why archived:
1. **Duplicate files**: These were copies of the main source files from `/cpp/`
2. **Build system**: CMakeLists.txt uses the main source files from `/Users/adilyoltay/Desktop/heartpy/cpp/`
3. **Consistency**: Single source of truth maintained in root `/cpp/` folder
4. **JSI development**: Cleanup before JSI implementation to avoid confusion

## Current structure:
- **Main source**: `/cpp/heartpy_core.{cpp,h}` and `/cpp/heartpy_stream.{cpp,h}`
- **RN-specific**: `/react-native-heartpy/cpp/rn_options_builder.{cpp,h}`

## Build verification:
CMakeLists.txt confirmed to use correct source files:
```cmake
/Users/adilyoltay/Desktop/heartpy/cpp/heartpy_core.cpp
/Users/adilyoltay/Desktop/heartpy/cpp/heartpy_stream.cpp
/Users/adilyoltay/Desktop/heartpy/react-native-heartpy/cpp/rn_options_builder.cpp
```

**Status: Safe to delete after confirming builds work correctly**
