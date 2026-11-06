#!/usr/bin/env bash
# Build the Emscripten runtimes the WASM backend fetches from <base>/wasm/ at runtime:
#   static/wasm/radau5.{js,wasm}  RADAU5, DOP853, DOPRI5, LSODA + fitting (always loaded)
#   static/wasm/cvode.{js,wasm}   SUNDIALS CVODE (loaded only when a cvode_* method runs)
#   static/wasm/THIRD-PARTY-LICENCES.txt  licences of the solvers compiled into them
# Sites copy static/wasm/ wholesale, so everything here is deployed next to each other.
# Needs emcc on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v emcc >/dev/null || { echo "emcc not found; install and activate emsdk first" >&2; exit 1; }

COMMON=(-s WASM=1 -s MODULARIZE=1 -s ALLOW_TABLE_GROWTH=1 -s ALLOW_MEMORY_GROWTH=1
  -s RESERVED_FUNCTION_POINTERS=8 -O2 -Wno-deprecated-non-prototype
  -s 'EXPORTED_RUNTIME_METHODS=["addFunction","removeFunction","ccall","cwrap","HEAPF64","HEAP32","wasmMemory"]')
OUTPUT_FNS='"_set_model_fn","_init_output","_free_output","_get_out_n","_get_out_t","_get_out_y","_set_output_grid","_malloc","_free"'

S=src-c
RADAU_FNS='"_run_radau5","_run_dop853","_run_dopri5","_run_lsoda","_set_derived_fn","_set_derived_grad_fn",'
RADAU_FNS+='"_fit_init","_fit_chunk","_fit_get_nfev","_fit_get_residual_norm","_fit_get_params","_fit_get_predictions","_fit_free","_fit_set_progress_fn",'
RADAU_FNS+='"_set_forward_model_fn","_set_adjoint_fn","_adjoint_init","_adjoint_chunk","_adjoint_get_steps","_adjoint_get_residual_norm","_adjoint_get_grad_norm","_adjoint_get_grad","_adjoint_get_params","_adjoint_free","_adjoint_get_predictions","_adjoint_set_progress_fn",'
RADAU_FNS+='"_jacobian_set_plain_fn","_jacobian_set_augmented_fn","_jacobian_init","_jacobian_chunk","_jacobian_get_nfev","_jacobian_get_residual_norm","_jacobian_get_params","_jacobian_free","_jacobian_get_predictions","_jacobian_get_jacobian","_jacobian_set_progress_fn"'
emcc $S/radau5.c $S/dc_decsol.c $S/decsol.c $S/dop853.c $S/dopri5.c $S/lsoda.c $S/mxs_lapack.c \
  $S/radau5_wrapper.c $S/solver_common.c $S/libf2c_stubs.c $S/fit_experiments.c $S/fit_wrapper.c \
  $S/adjoint_wrapper.c $S/jacobian_wrapper.c $S/minpack/{lmdif,lmder,dpmpar,enorm,fdjac2,qrfac,lmpar,qrsolv}.c \
  -I $S -o static/wasm/radau5.js -s EXPORT_NAME=RadauModule "${COMMON[@]}" \
  -s "EXPORTED_FUNCTIONS=[$RADAU_FNS,$OUTPUT_FNS]"

# Every SUNDIALS file mxl-solvers vendors is needed (CVODE only).
mapfile -t SUNDIALS < <(find $S/sundials/src -name '*.c' | LC_ALL=C sort)
emcc $S/cvode_wrapper.c $S/solver_common.c "${SUNDIALS[@]}" \
  -I $S -I $S/sundials/include -I $S/sundials/src/sundials \
  -o static/wasm/cvode.js -s EXPORT_NAME=CvodeModule "${COMMON[@]}" \
  -s "EXPORTED_FUNCTIONS=[\"_run_cvode\",$OUTPUT_FNS]"

{
  echo "Third-party code compiled into radau5.wasm and cvode.wasm, with its licences."
  echo "radau5.wasm: RADAU5, DOP853, DOPRI5 (Hairer & Wanner), LSODA (SciPy) and cminpack."
  echo "cvode.wasm: CVODE from SUNDIALS v7.9.0 (https://github.com/LLNL/sundials)."
  for f in $S/HAIRER-LICENCE.txt $S/SCIPY-LICENCE.txt $S/minpack/COPYRIGHT.txt \
    $S/SUNDIALS-LICENCE.txt $S/SUNDIALS-NOTICE.txt; do
    printf '\n==== %s ====\n\n' "${f#"$S"/}"
    cat "$f"
  done
} > static/wasm/THIRD-PARTY-LICENCES.txt
ls -l static/wasm/
