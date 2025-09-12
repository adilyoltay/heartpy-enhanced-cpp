// Central options validation and (future) JS builders for RN bridges
#pragma once

#include <string>
#include "../../cpp/heartpy_core.h"

// Returns false if options are invalid. On failure, sets err_code (stable code)
// and err_msg (short reason). On success, err_code/msg are untouched.
// This function performs validation only (no mutation). Clamping/snap logic is
// left to call sites or underlying core behavior. This preserves current P0 behavior.
extern "C" bool hp_validate_options(double fs,
                                     const heartpy::Options& opt,
                                     const char** err_code,
                                     std::string* err_msg);

