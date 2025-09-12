cmake_minimum_required(VERSION 3.15)
project(heartpy_rn)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(heartpy_rn SHARED
    native_analyze.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp/heartpy_core.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp/heartpy_stream.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../cpp/rn_options_builder.cpp
)

target_include_directories(heartpy_rn PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../../../../cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft
  ${CMAKE_CURRENT_SOURCE_DIR}/../../cpp
)

# Use vendored KissFFT if available within the package
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fft.c AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fftr.c)
  add_library(kissfft STATIC
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fft.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft/kiss_fftr.c)
  target_include_directories(kissfft PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/kissfft)
  target_compile_definitions(heartpy_rn PRIVATE USE_KISSFFT=1)
  target_link_libraries(heartpy_rn kissfft)
endif()

target_link_libraries(heartpy_rn android log)


