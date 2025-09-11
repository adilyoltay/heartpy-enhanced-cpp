cmake_minimum_required(VERSION 3.15)
project(heartpy_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(heartpy_core STATIC
    cpp/heartpy_core.cpp
    cpp/heartpy_stream.cpp
)

target_include_directories(heartpy_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/cpp
)

if(APPLE)
    target_link_libraries(heartpy_core PRIVATE "-framework Accelerate")
    target_compile_definitions(heartpy_core PRIVATE USE_ACCELERATE_FFT=1)
endif()
option(USE_KISSFFT "Use KissFFT if available" ON)
if(USE_KISSFFT)
    # Prefer vendored kissfft if present
    if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/third_party/kissfft/kiss_fft.c AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/third_party/kissfft/kiss_fftr.c)
        message(STATUS "Using vendored KissFFT")
        target_sources(heartpy_core PRIVATE
            third_party/kissfft/kiss_fft.c
            third_party/kissfft/kiss_fftr.c)
        target_include_directories(heartpy_core PRIVATE third_party/kissfft)
        target_compile_definitions(heartpy_core PRIVATE USE_KISSFFT=1)
    else()
        find_path(KISSFFT_INCLUDE_DIR kiss_fftr.h)
        find_library(KISSFFT_LIB NAMES kissfft kissfft-float)
        if(KISSFFT_INCLUDE_DIR AND KISSFFT_LIB)
            message(STATUS "Using system KissFFT: ${KISSFFT_INCLUDE_DIR}")
            target_include_directories(heartpy_core PRIVATE ${KISSFFT_INCLUDE_DIR})
            target_link_libraries(heartpy_core PRIVATE ${KISSFFT_LIB})
            target_compile_definitions(heartpy_core PRIVATE USE_KISSFFT=1)
        else()
            message(WARNING "KissFFT not found; falling back to internal FFT")
        endif()
    endif()
endif()

if(MSVC)
    target_compile_options(heartpy_core PRIVATE /W4)
else()
    target_compile_options(heartpy_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Optional example executable (can be expanded later)
add_executable(heartpy_example examples/example_main.cpp)
target_link_libraries(heartpy_example PRIVATE heartpy_core)

# MIT-BIH RR validation tool
add_executable(validate_rr_intervals examples/validate_rr_intervals.cpp)
target_link_libraries(validate_rr_intervals PRIVATE heartpy_core)

# Smoke test executable for CI/local validation
add_executable(heartpy_smoke examples/smoke_test.cpp)
target_link_libraries(heartpy_smoke PRIVATE heartpy_core)

add_executable(heartpy_compare_cpp examples/compare_cpp.cpp)
target_link_libraries(heartpy_compare_cpp PRIVATE heartpy_core)

add_executable(heartpy_compare_json examples/compare_cpp_json.cpp)
target_link_libraries(heartpy_compare_json PRIVATE heartpy_core)

add_executable(heartpy_compare_file_json examples/compare_file_json.cpp)
target_link_libraries(heartpy_compare_file_json PRIVATE heartpy_core)

add_executable(heartpy_compare_rr_json examples/compare_rr_json.cpp)
target_link_libraries(heartpy_compare_rr_json PRIVATE heartpy_core)
add_executable(realtime_demo examples/realtime_demo.cpp)
target_link_libraries(realtime_demo PRIVATE heartpy_core)
