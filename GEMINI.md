# GEMINI.md: Your AI Assistant's Guide to this Project

This file provides context for Gemini, your AI assistant, to understand the structure, conventions, and goals of the `heartpy-enhanced-cpp` project.

## Project Overview

This project is a C++ implementation of the HeartPy library, enhanced with real-time streaming analysis capabilities and a React Native bridge for mobile applications. The core of the project is a C++ library that performs heart rate (HR), heart rate variability (HRV), and other related analyses from physiological signals like photoplethysmography (PPG).

**Key Components:**

*   **`cpp/`**: Contains the core C++ source code for the HeartPy analysis library.
    *   `heartpy_core.h`/`.cpp`: Implements the main analysis functions, data structures, and algorithms.
    *   `heartpy_stream.h`/`.cpp`: Provides a real-time streaming analyzer for continuous data processing.
*   **`react-native-heartpy/`**: A React Native package that wraps the C++ library, allowing it to be used in mobile apps.
*   **`HeartPyApp/`**: An example React Native application demonstrating the usage of the `react-native-heartpy` package.
*   **`examples/`**: A collection of C++ examples and command-line tools for testing and demonstrating the library's features.
*   **`CMakeLists.txt`**: The main build script for the C++ library and examples.

**Technologies Used:**

*   **C++17**: The core library is written in modern C++.
*   **CMake**: Used for building the C++ project.
*   **React Native**: For the mobile application bridge.
*   **JSI (JavaScript Interface)**: Used for communication between the React Native and C++ layers.
*   **Apple Accelerate/vDSP & ARM NEON**: Optional hardware acceleration for performance-critical operations.
*   **KissFFT**: An optional FFT library dependency.

## Building and Running

The project uses CMake to build the C++ library and associated examples.

### Building the C++ Core

To build the C++ library and examples on a Mac, you can use the following commands:

```bash
cmake -S . -B build-mac -DCMAKE_BUILD_TYPE=Release
cmake --build build-mac -j
```

### Running Acceptance Tests

The project includes a suite of acceptance tests to verify the correctness of the analysis algorithms. To run these tests:

```bash
cmake --build build-mac --target acceptance
```

### Running Examples

The `examples/` directory contains several executables that demonstrate different features of the library. For example, to run the `realtime_demo`:

```bash
./build-mac/realtime_demo
```

## Development Conventions

*   **Coding Style**: The C++ code generally follows modern C++ practices. Header files (`.h`) are used for declarations, and source files (`.cpp`) for implementations.
*   **Testing**: The project has a strong emphasis on testing, with a dedicated `acceptance` target and various example programs for validation.
*   **Dependencies**: The C++ library has optional dependencies on hardware acceleration libraries (Accelerate, NEON) and KissFFT. These are managed through CMake options.
*   **React Native Package**: The `react-native-heartpy` package follows standard Node.js/React Native project conventions, with a `package.json` file defining scripts and dependencies.

## Mobile (React Native) Integration

The `react-native-heartpy` package provides the bridge to use the C++ library in a React Native application.

### Installation

To use the package in a React Native project, you can add it as a local dependency:

```bash
yarn add file:./react-native-heartpy
```

### Usage

The package exposes an `analyzeAsync` function that takes a PPG data array and analysis options, and returns the analysis results.

```typescript
import { installJSI, analyzeAsync } from 'react-native-heartpy';

// Optional: Install the JSI bridge on iOS
installJSI();

const ppgArray = [/* your PPG data */];
const sampleRate = 50; // Hz

const results = await analyzeAsync(ppgArray, sampleRate, {
  // Analysis options
});

console.log(results.bpm, results.quality.confidence);
```

For more detailed instructions on mobile integration, refer to `docs/mobile_integration.md` and `react-native-heartpy/README.md`.
