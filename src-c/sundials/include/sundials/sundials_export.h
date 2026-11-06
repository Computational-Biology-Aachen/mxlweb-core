/* -----------------------------------------------------------------
 * SUNDIALS Copyright Start
 * Copyright (c) 2025-2026, Lawrence Livermore National Security,
 * University of Maryland Baltimore County, and the SUNDIALS contributors.
 * Copyright (c) 2013-2025, Lawrence Livermore National Security
 * and Southern Methodist University.
 * Copyright (c) 2002-2013, Lawrence Livermore National Security.
 * All rights reserved.
 *
 * See the top-level LICENSE and NOTICE files for details.
 *
 * SPDX-License-Identifier: BSD-3-Clause
 * SUNDIALS Copyright End
 * -----------------------------------------------------------------
 * mxl-solvers: CMake's GenerateExportHeader writes this file for SUNDIALS. mxl-solvers'
 * consumers always compile SUNDIALS straight into their own library, so nothing is
 * exported and the macros are empty. The deprecation attributes are detected per
 * compiler instead of by CMake.
 * -----------------------------------------------------------------*/

#ifndef SUNDIALS_EXPORT_H
#define SUNDIALS_EXPORT_H

#ifndef SUNDIALS_EXPORT
#define SUNDIALS_EXPORT
#endif
#ifndef SUNDIALS_NO_EXPORT
#define SUNDIALS_NO_EXPORT
#endif

#ifndef SUNDIALS_DEPRECATED_ATTRIBUTE
#if defined(__GNUC__) || defined(__clang__)
#define SUNDIALS_DEPRECATED_ATTRIBUTE __attribute__((__deprecated__))
#elif defined(_MSC_VER)
#define SUNDIALS_DEPRECATED_ATTRIBUTE __declspec(deprecated)
#else
#define SUNDIALS_DEPRECATED_ATTRIBUTE
#endif
#endif

#ifndef SUNDIALS_DEPRECATED_ATTRIBUTE_EXPORT
#define SUNDIALS_DEPRECATED_ATTRIBUTE_EXPORT \
  SUNDIALS_EXPORT SUNDIALS_DEPRECATED_ATTRIBUTE
#endif

#ifndef SUNDIALS_DEPRECATED_ATTRIBUTE_NO_EXPORT
#define SUNDIALS_DEPRECATED_ATTRIBUTE_NO_EXPORT \
  SUNDIALS_NO_EXPORT SUNDIALS_DEPRECATED_ATTRIBUTE
#endif

#endif /* SUNDIALS_EXPORT_H */
