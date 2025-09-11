cmake_minimum_required(VERSION 3.15)
project(heartpy_rn)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Locate ReactAndroid CMake package for imported targets (jsi, reactnativejni, fbjni)
if(NOT DEFINED REACT_NATIVE_DIR)
  message(FATAL_ERROR "REACT_NATIVE_DIR not set")
endif()
# No ReactAndroid CMake package needed for plain JNI

add_library(heartpy_rn SHARED
    native_analyze.cpp
    ${CMAKE_SOURCE_DIR}/../../../../cpp/heartpy_core.cpp
)

if(NOT DEFINED REACT_NATIVE_DIR)
  message(FATAL_ERROR "REACT_NATIVE_DIR not set")
endif()

target_include_directories(heartpy_rn PRIVATE
  ${CMAKE_SOURCE_DIR}/../../../../cpp
)

# Use vendored KissFFT if available
if(EXISTS ${CMAKE_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fft.c AND EXISTS ${CMAKE_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fftr.c)
  add_library(kissfft STATIC
    ${CMAKE_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fft.c
    ${CMAKE_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fftr.c)
  target_include_directories(kissfft PUBLIC ${CMAKE_SOURCE_DIR}/../../../../third_party/kissfft)
  target_compile_definitions(heartpy_rn PRIVATE USE_KISSFFT=1)
  target_link_libraries(heartpy_rn kissfft)
endif()

target_link_libraries(heartpy_rn android log)


