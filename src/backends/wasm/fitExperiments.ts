/**
 * fitExperiments.ts — marshalling of `FitInitRequest.experiments` (ADR 0009)
 * into the flat arrays fit_wrapper.c's `fit_init` takes. Kept out of
 * fitWorker.ts (which installs a Worker `onmessage` on import) so it can be
 * unit-tested and reused outside a worker.
 */
import type { FitInitRequest } from "../../index.js";

/** fit_wrapper.c's EXP_* experiment kinds. */
const EXP_TIME_COURSE = 0;
const EXP_STEADY_STATE = 1;
export const DEFAULT_SS_TOL = 1e-6;
export const DEFAULT_SS_T_MAX = 1e6;

/** Flattens `req.experiments` into fit_init's experiment arrays (see
 * fit_wrapper.c's fit_init doc comment for the layout), or returns an
 * error message. */
export function flattenExperiments(req: FitInitRequest):
  | {
      ovrIdx: number[];
      expKind: number[];
      expNSeg: number[];
      expNPoints: number[];
      segTEnd: number[];
      segOvr: number[];
      dataT: number[];
      dataY: number[];
    }
  | string {
  const ovrNames: string[] = [];
  const addName = (name: string) => {
    if (!ovrNames.includes(name)) ovrNames.push(name);
  };
  for (const exp of req.experiments) {
    if (exp.kind === "steadyState") Object.keys(exp.overrides).forEach(addName);
    else
      for (const step of exp.protocol ?? [])
        Object.keys(step)
          .filter((k) => k !== "t_end")
          .forEach(addName);
  }
  const parNames = req.parNames ?? [];
  const ovrIdx = ovrNames.map((name) => parNames.indexOf(name));
  const unknown = ovrNames.filter((_, i) => ovrIdx[i] < 0);
  if (unknown.length > 0) {
    return `Unknown parameter(s) in protocol/conditions: ${unknown.join(", ")}.`;
  }
  const row = (values: Record<string, number>) =>
    ovrNames.map((name) => values[name] ?? NaN);

  const out = {
    ovrIdx,
    expKind: [] as number[],
    expNSeg: [] as number[],
    expNPoints: [] as number[],
    segTEnd: [] as number[],
    segOvr: [] as number[],
    dataT: [] as number[],
    dataY: [] as number[],
  };
  for (const exp of req.experiments) {
    if (exp.kind === "steadyState") {
      out.expKind.push(EXP_STEADY_STATE);
      out.expNSeg.push(1);
      out.expNPoints.push(1);
      out.segTEnd.push(0);
      out.segOvr.push(...row(exp.overrides));
      out.dataT.push(0);
    } else {
      const steps =
        exp.protocol && exp.protocol.length > 0
          ? exp.protocol
          : [{ t_end: exp.dataT[exp.dataT.length - 1] ?? 0 }];
      out.expKind.push(EXP_TIME_COURSE);
      out.expNSeg.push(steps.length);
      out.expNPoints.push(exp.dataT.length);
      for (const step of steps) {
        out.segTEnd.push(step.t_end);
        out.segOvr.push(...row(step));
      }
      out.dataT.push(...exp.dataT);
    }
    out.dataY.push(...exp.dataY);
  }
  return out;
}
