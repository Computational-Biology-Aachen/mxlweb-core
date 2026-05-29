export * from './modelBuilder.js';
export * from './backends/js/integrators/index.js';

export interface SimulationRequest {
  // Required; don't change!
  requestId: string;
  rhsFn?: string;
  /** WAT module string for native WASM backend (method === 'radau5') */
  rhsWat?: string;
  allDerivedFn: string;
  selectDerivedFn: string;
  initialValues: number[];
  rhsNames: Array<string>;
  allDerivedNames: Array<string>;
  selectDerivedNames: Array<string>;
  tEnd: number;
  nTimePoints: number;
  pars: number[];
  method: string;
  calculateDerived: boolean;
  // Optional
  type?: string;
  parNames?: string[];
  protocol?: Array<{ t_end: number } & Record<string, number>>;
  /** Relative solver tolerance. Defaults per backend if omitted. */
  rtol?: number;
  /** Absolute solver tolerance. Defaults per backend if omitted. */
  atol?: number;
}

export interface SimulationError {
  message: string;
  hints: Array<String>;
  dxdt?: Array<{ name: string; val: number }>;
  args?: Array<{ name: string; val: number }>;
}

export interface SimulationResult {
  time: number[];
  values: number[][];
  requestId?: string;
  err?: SimulationError;
}
