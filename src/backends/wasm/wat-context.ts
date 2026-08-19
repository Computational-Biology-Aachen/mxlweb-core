export interface WatContext {
  varIndex: Map<string, number>;
  parIndex: Map<string, number>;
  /** Name of the time variable in the model (maps to the $t f64 param) */
  timeVar?: string;
  /** Reaction/assignment names available as WAT named locals ($name) */
  localNames?: Set<string>;
  /**
   * Adjoint-state symbol name → index into the adjoint function's `lambda`
   * input array (ADR 0005 §2.3/§4's backward-WAT orchestration). Only
   * populated by `buildAdjointWat`; `undefined` in every other codegen
   * context, so a plain forward/derived WAT build never resolves through
   * this branch at all. Names are `__adjoint_lambda_{i}` — double-underscore
   * prefixed specifically so they can't collide with a real model symbol a
   * user might author (see `adjointLambdaName` in `modelIr.ts`).
   */
  lambdaIndex?: Map<string, number>;
}
