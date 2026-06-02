/**
 * PAM (pulse amplitude modulation) fluorometry: protocol building and analysis.
 *
 * Shared between consumers (mxlweb explorer, comphot education site) so the
 * fluorescence math and protocol semantics live in one place.
 *
 * A protocol is a flat list of steps; each step applies a light intensity
 * (under `ppfdKey`) from the previous step's `t_end` up to its own `t_end`.
 */

// ---------------------------------------------------------------------------
// Protocol types + expansion
// ---------------------------------------------------------------------------

export interface ProtocolStep {
  t_end: number;
  [key: string]: number;
}

export type Protocol = ProtocolStep[];

export interface PamStep {
  pfd: number;
  duration: number;
  label?: string;
}

export interface PamGroup {
  steps: PamStep[];
  repetitions: number;
}

/**
 * Flatten duration-based PamGroups into an absolute-time ProtocolStep[].
 *
 * Steps whose duration is <= 0 are dropped (drop-empty guard): they neither
 * emit a ProtocolStep nor advance the time cursor. This lets builders express
 * conditional segments as zero/negative durations without polluting the output.
 */
export function expandProtocol(groups: PamGroup[], ppfdKey: string): Protocol {
  const steps: ProtocolStep[] = [];
  let t = 0;
  for (const group of groups) {
    for (let i = 0; i < group.repetitions; i++) {
      for (const step of group.steps) {
        if (step.duration <= 0) continue;
        t += step.duration;
        steps.push({ t_end: t, [ppfdKey]: step.pfd });
      }
    }
  }
  return steps;
}

const PULSE_LENGTH = 0.8; // seconds — duration of each saturating pulse

/** A protocol event expressed as the absolute time it should reach. */
interface Candidate {
  t_end: number;
  pfd: number;
}

/**
 * Convert an ordered list of absolute-time candidates into PamSteps, skipping
 * any candidate that does not advance the running cursor. This replicates the
 * `addStep` guard the original comphot builders used (only emit when
 * `t_end > t`), so non-advancing events collapse exactly as before.
 */
function candidatesToSteps(candidates: Candidate[]): PamStep[] {
  const steps: PamStep[] = [];
  let t = 0;
  for (const c of candidates) {
    if (c.t_end > t) {
      steps.push({ pfd: c.pfd, duration: c.t_end - t });
      t = c.t_end;
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Protocol builders (phase-based) — port of comphot `_model_functions.py`
// ---------------------------------------------------------------------------

export interface PamParams {
  /** Actinic light intensity in μmol m⁻² s⁻¹ */
  lightIntensity: number;
  /** Saturating pulse intensity in μmol m⁻² s⁻¹ */
  saturatingPulse: number;
  /** Total experiment duration in minutes */
  totalMinutes: number;
  /** Dark phase length in seconds */
  darkLength: number;
  /** Seconds between saturating pulses during the light phase */
  pulseInterval: number;
}

/**
 * Build a PAM fluorometry protocol that replicates `sim_model()`.
 *
 * Structure:
 *  1. Dark period from t=0 to t=2
 *  2. Saturating pulse at t=2 (dark conditions)
 *  3. Continue dark until t=darkLength
 *  4. Saturating pulse at t=darkLength (transition)
 *  5. Light phase with pulses every pulseInterval seconds until totalMinutes
 */
export function buildPamProtocol(params: PamParams): ProtocolStep[] {
  const {
    lightIntensity,
    saturatingPulse,
    totalMinutes,
    darkLength,
    pulseInterval,
  } = params;
  const maxTime = totalMinutes * 60;
  const dark = 0;

  const candidates: Candidate[] = [];

  // 1. Initial dark period up to t=2
  candidates.push({ t_end: 2, pfd: dark });
  // 2. Saturating pulse at t=2
  candidates.push({ t_end: 2 + PULSE_LENGTH, pfd: saturatingPulse });
  // 3. Continue dark until t=darkLength
  candidates.push({ t_end: darkLength, pfd: dark });
  // 4. Saturating pulse at t=darkLength
  candidates.push({ t_end: darkLength + PULSE_LENGTH, pfd: saturatingPulse });

  // 5. Light phase with pulses every pulseInterval (start of phase: darkLength)
  const numPulses = Math.floor((maxTime - darkLength) / pulseInterval);
  for (let j = 0; j <= numPulses; j++) {
    const pulseStart = darkLength + pulseInterval * j;
    if (pulseStart >= maxTime) break;

    if (j > 0) {
      // Light segment up to next pulse
      candidates.push({ t_end: pulseStart, pfd: lightIntensity });
    }

    // Saturating pulse (clamped to maxTime)
    const pulseEnd = Math.min(pulseStart + PULSE_LENGTH, maxTime);
    candidates.push({ t_end: pulseEnd, pfd: saturatingPulse });
  }

  // 6. Final light segment to maxTime
  candidates.push({ t_end: maxTime, pfd: lightIntensity });

  return expandProtocol(
    [{ steps: candidatesToSteps(candidates), repetitions: 1 }],
    "PPFD",
  );
}

// ---------------------------------------------------------------------------

export interface MemoryPamParams {
  /** Actinic light intensity in μmol m⁻² s⁻¹ */
  lightIntensity: number;
  /** Saturating pulse intensity in μmol m⁻² s⁻¹ */
  saturatingPulse: number;
  /** Dark phase length in seconds */
  darkLength: number;
  /** Seconds between saturating pulses */
  pulseInterval: number;
  /** Training phase length in seconds */
  trainingLength: number;
  /** Relaxation phase length in seconds */
  relaxationLength: number;
  /** Memory phase length in seconds */
  memoryLength: number;
}

/**
 * Build a plant memory PAM protocol that replicates `sim_model_memory()`.
 *
 * Structure:
 *  1. Dark period with pulses (darkLength seconds)
 *  2. Training phase — actinic light with pulses (trainingLength seconds)
 *  3. Relaxation phase — dark with pulses (relaxationLength seconds)
 *  4. Memory phase — actinic light with pulses (memoryLength seconds)
 */
export function buildMemoryProtocol(params: MemoryPamParams): ProtocolStep[] {
  const {
    lightIntensity,
    saturatingPulse,
    darkLength,
    pulseInterval,
    trainingLength,
    relaxationLength,
    memoryLength,
  } = params;

  const dark = 0;
  const candidates: Candidate[] = [];

  function simulatePeriod(
    startTime: number,
    phaseLength: number,
    duringLight: number,
    startingLight: number,
    isDark: boolean,
  ) {
    // Opening SP
    candidates.push({ t_end: startTime, pfd: startingLight });
    candidates.push({ t_end: startTime + PULSE_LENGTH, pfd: saturatingPulse });

    if (!isDark) {
      const numPulses = Math.floor(phaseLength / pulseInterval);
      for (let i = 1; i < numPulses; i++) {
        const pulseStart = startTime + pulseInterval * i;
        candidates.push({ t_end: pulseStart, pfd: duringLight });
        candidates.push({
          t_end: pulseStart + PULSE_LENGTH,
          pfd: saturatingPulse,
        });
      }
    }
  }

  // 1. Dark period
  if (darkLength > 0) {
    simulatePeriod(2, darkLength, dark, dark, true);
  }

  // 2. Training phase
  if (trainingLength > 0) {
    simulatePeriod(darkLength, trainingLength, lightIntensity, dark, false);
  }

  const relaxStart = darkLength + trainingLength;
  const relaxEnd = relaxStart + relaxationLength;

  // 3. Relaxation phase (two sub-periods as in _model_functions.py)
  if (relaxationLength > 0) {
    const relaxPeriod1End = relaxEnd - pulseInterval;
    simulatePeriod(
      relaxStart,
      relaxPeriod1End - relaxStart,
      dark,
      lightIntensity,
      true,
    );
    simulatePeriod(relaxPeriod1End, pulseInterval, dark, dark, true);
  }

  // 4. Memory phase
  if (memoryLength > 0) {
    simulatePeriod(relaxEnd, memoryLength, lightIntensity, dark, false);
  }

  // Final segment to total end
  const totalEnd =
    darkLength + trainingLength + relaxationLength + memoryLength;
  candidates.push({ t_end: totalEnd, pfd: lightIntensity });

  return expandProtocol(
    [{ steps: candidatesToSteps(candidates), repetitions: 1 }],
    "PPFD",
  );
}

// ---------------------------------------------------------------------------
// Fluorescence analysis
// ---------------------------------------------------------------------------

export function normalizeToMax(data: number[]): number[] {
  const max = Math.max(...data.filter(Number.isFinite));
  if (max === 0 || !Number.isFinite(max)) return data;
  return data.map((v) => v / max);
}

export function findPeaks(data: number[], minProminence: number): number[] {
  const n = data.length;
  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1]) candidates.push(i);
  }
  return candidates.filter((peakIdx) => {
    const peakVal = data[peakIdx];
    let leftMin = peakVal;
    for (let j = peakIdx - 1; j >= 0; j--) {
      if (data[j] > peakVal) break;
      leftMin = Math.min(leftMin, data[j]);
    }
    let rightMin = peakVal;
    for (let j = peakIdx + 1; j < n; j++) {
      if (data[j] > peakVal) break;
      rightMin = Math.min(rightMin, data[j]);
    }
    return peakVal - Math.max(leftMin, rightMin) >= minProminence;
  });
}

export function interpolateAtIndices(
  indices: number[],
  values: number[],
  length: number,
  method: "linear" | "akima" = "linear",
): number[] {
  const out = new Array(length).fill(NaN);
  if (indices.length === 0) return out;

  if (method === "akima") {
    const n = indices.length;
    if (n === 1) {
      for (let k = 0; k < length; k++) out[k] = values[0];
      return out;
    }
    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      m.push((values[i + 1] - values[i]) / (indices[i + 1] - indices[i]));
    }
    const mExt = [
      2 * m[0] - m[1],
      2 * m[0] - m[1],
      ...m,
      2 * m[n - 2] - m[n - 3 < 0 ? 0 : n - 3],
      2 * m[n - 2] - m[n - 3 < 0 ? 0 : n - 3],
    ];
    const t: number[] = [];
    for (let i = 0; i < n; i++) {
      const w1 = Math.abs(mExt[i + 3] - mExt[i + 2]);
      const w2 = Math.abs(mExt[i + 1] - mExt[i]);
      const denom = w1 + w2;
      t.push(
        denom < 1e-14
          ? (mExt[i + 1] + mExt[i + 2]) / 2
          : (w1 * mExt[i + 1] + w2 * mExt[i + 2]) / denom,
      );
    }
    for (let p = 0; p < n - 1; p++) {
      const x0 = indices[p],
        x1 = indices[p + 1];
      const y0 = values[p],
        y1 = values[p + 1];
      const t0 = t[p],
        t1 = t[p + 1];
      const h = x1 - x0;
      const end = p === n - 2 ? x1 : x1 - 1;
      for (let k = x0; k <= end; k++) {
        const u = (k - x0) / h,
          u2 = u * u,
          u3 = u2 * u;
        out[k] =
          (2 * u3 - 3 * u2 + 1) * y0 +
          (u3 - 2 * u2 + u) * h * t0 +
          (-2 * u3 + 3 * u2) * y1 +
          (u3 - u2) * h * t1;
      }
    }
    return out;
  }

  // linear
  indices.forEach((i, j) => {
    out[i] = values[j];
  });
  for (let p = 0; p < indices.length - 1; p++) {
    const i0 = indices[p],
      i1 = indices[p + 1],
      v0 = values[p],
      v1 = values[p + 1];
    for (let k = i0 + 1; k < i1; k++) {
      out[k] = v0 + ((v1 - v0) * (k - i0)) / (i1 - i0);
    }
  }
  return out;
}

export function computeNpq(
  fluoNorm: number[],
  peakIndices: number[],
): number[] {
  if (peakIndices.length === 0) return [];
  const Fm0 = fluoNorm[peakIndices[0]];
  return peakIndices.map((i) => (Fm0 - fluoNorm[i]) / fluoNorm[i]);
}

export function computePhiPsii(
  fluoNorm: number[],
  peakIndices: number[],
): number[] {
  return peakIndices.map((peakIdx, i) => {
    const Fm = fluoNorm[peakIdx];
    const leftBoundary = i > 0 ? peakIndices[i - 1] : 0;
    let Fo = Fm;
    for (let j = peakIdx - 1; j >= leftBoundary; j--) {
      if (fluoNorm[j] < Fo) Fo = fluoNorm[j];
    }
    return (Fm - Fo) / Fm;
  });
}
