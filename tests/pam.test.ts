import { describe, it, expect } from "vitest";
import {
  buildPamProtocol,
  buildMemoryProtocol,
  expandProtocol,
  normalizeToMax,
  findPeaks,
  computeNpq,
  computePhiPsii,
  type ProtocolStep,
} from "../src/pam.js";

// ---------------------------------------------------------------------------
// Golden oracles: the original comphot flat builders (addStep-based). The core
// builders must produce byte-identical output to these.
// ---------------------------------------------------------------------------

const PULSE_LENGTH = 0.8;

function oraclePam(params: {
  lightIntensity: number;
  saturatingPulse: number;
  totalMinutes: number;
  darkLength: number;
  pulseInterval: number;
}): ProtocolStep[] {
  const {
    lightIntensity,
    saturatingPulse,
    totalMinutes,
    darkLength,
    pulseInterval,
  } = params;
  const maxTime = totalMinutes * 60;
  const dark = 0;
  const steps: ProtocolStep[] = [];
  let t = 0;
  function addStep(t_end: number, PPFD: number) {
    if (t_end > t) {
      steps.push({ t_end, PPFD });
      t = t_end;
    }
  }
  if (t < 2) addStep(2, dark);
  addStep(2 + PULSE_LENGTH, saturatingPulse);
  if (t < darkLength) addStep(darkLength, dark);
  addStep(darkLength + PULSE_LENGTH, saturatingPulse);
  const numPulses = Math.floor((maxTime - darkLength) / pulseInterval);
  for (let j = 0; j <= numPulses; j++) {
    const pulseStart = darkLength + pulseInterval * j;
    if (pulseStart >= maxTime) break;
    if (j > 0) addStep(pulseStart, lightIntensity);
    const pulseEnd = Math.min(pulseStart + PULSE_LENGTH, maxTime);
    addStep(pulseEnd, saturatingPulse);
  }
  if (t < maxTime) addStep(maxTime, lightIntensity);
  return steps;
}

function oracleMemory(params: {
  lightIntensity: number;
  saturatingPulse: number;
  darkLength: number;
  pulseInterval: number;
  trainingLength: number;
  relaxationLength: number;
  memoryLength: number;
}): ProtocolStep[] {
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
  const steps: ProtocolStep[] = [];
  let t = 0;
  function addStep(t_end: number, PPFD: number) {
    if (t_end > t) {
      steps.push({ t_end, PPFD });
      t = t_end;
    }
  }
  function simulatePeriod(
    startTime: number,
    phaseLength: number,
    duringLight: number,
    startingLight: number,
    isDark: boolean,
  ) {
    addStep(startTime, startingLight);
    addStep(startTime + PULSE_LENGTH, saturatingPulse);
    if (!isDark) {
      const numPulses = Math.floor(phaseLength / pulseInterval);
      for (let i = 1; i < numPulses; i++) {
        const pulseStart = startTime + pulseInterval * i;
        addStep(pulseStart, duringLight);
        addStep(pulseStart + PULSE_LENGTH, saturatingPulse);
      }
    }
  }
  if (darkLength > 0) simulatePeriod(2, darkLength, dark, dark, true);
  if (trainingLength > 0)
    simulatePeriod(darkLength, trainingLength, lightIntensity, dark, false);
  const relaxStart = darkLength + trainingLength;
  const relaxEnd = relaxStart + relaxationLength;
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
  if (memoryLength > 0)
    simulatePeriod(relaxEnd, memoryLength, lightIntensity, dark, false);
  const totalEnd =
    darkLength + trainingLength + relaxationLength + memoryLength;
  if (t < totalEnd) addStep(totalEnd, lightIntensity);
  return steps;
}

// ---------------------------------------------------------------------------
// Golden tests
// ---------------------------------------------------------------------------

describe("buildPamProtocol golden equivalence", () => {
  const cases = [
    // default experiments-page values
    {
      lightIntensity: 100,
      saturatingPulse: 5000,
      totalMinutes: 5,
      darkLength: 30,
      pulseInterval: 85,
    },
    // short experiment, frequent pulses
    {
      lightIntensity: 200,
      saturatingPulse: 4000,
      totalMinutes: 2,
      darkLength: 10,
      pulseInterval: 30,
    },
    // long experiment
    {
      lightIntensity: 50,
      saturatingPulse: 6000,
      totalMinutes: 10,
      darkLength: 60,
      pulseInterval: 120,
    },
    // pulseInterval larger than light window (single pulse)
    {
      lightIntensity: 100,
      saturatingPulse: 5000,
      totalMinutes: 1,
      darkLength: 20,
      pulseInterval: 200,
    },
  ];
  it.each(cases)("matches oracle for %o", (params) => {
    expect(buildPamProtocol(params)).toEqual(oraclePam(params));
  });
});

describe("buildMemoryProtocol golden equivalence", () => {
  const cases = [
    // default plant-memory-page values
    {
      lightIntensity: 100,
      saturatingPulse: 5000,
      darkLength: 30,
      pulseInterval: 85,
      trainingLength: 300,
      relaxationLength: 300,
      memoryLength: 300,
    },
    // shorter phases
    {
      lightIntensity: 150,
      saturatingPulse: 4500,
      darkLength: 15,
      pulseInterval: 40,
      trainingLength: 120,
      relaxationLength: 120,
      memoryLength: 120,
    },
    // asymmetric phases
    {
      lightIntensity: 80,
      saturatingPulse: 5500,
      darkLength: 45,
      pulseInterval: 60,
      trainingLength: 240,
      relaxationLength: 180,
      memoryLength: 360,
    },
  ];
  it.each(cases)("matches oracle for %o", (params) => {
    expect(buildMemoryProtocol(params)).toEqual(oracleMemory(params));
  });
});

describe("expandProtocol drop-empty guard", () => {
  it("drops zero/negative duration steps without advancing time", () => {
    const out = expandProtocol(
      [
        {
          steps: [
            { pfd: 0, duration: 2 },
            { pfd: 100, duration: 0 }, // dropped
            { pfd: 200, duration: -5 }, // dropped
            { pfd: 300, duration: 3 },
          ],
          repetitions: 1,
        },
      ],
      "PPFD",
    );
    expect(out).toEqual([
      { t_end: 2, PPFD: 0 },
      { t_end: 5, PPFD: 300 },
    ]);
  });

  it("honours repetitions", () => {
    const out = expandProtocol(
      [{ steps: [{ pfd: 1, duration: 1 }], repetitions: 3 }],
      "PPFD",
    );
    expect(out.map((s) => s.t_end)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Fix-focused unit tests
// ---------------------------------------------------------------------------

describe("normalizeToMax", () => {
  it("scales to the max value", () => {
    expect(normalizeToMax([1, 2, 4])).toEqual([0.25, 0.5, 1]);
  });

  it("ignores NaN/Infinity when finding the max (NaN-safety fix)", () => {
    expect(normalizeToMax([1, 2, NaN, 4])).toEqual([0.25, 0.5, NaN, 1]);
    const withInf = normalizeToMax([2, Infinity, 4]);
    expect(withInf[0]).toBe(0.5);
    expect(withInf[2]).toBe(1);
  });

  it("returns data unchanged when max is 0 or non-finite", () => {
    expect(normalizeToMax([0, 0])).toEqual([0, 0]);
    expect(normalizeToMax([NaN, NaN])).toEqual([NaN, NaN]);
  });
});

describe("findPeaks", () => {
  it("finds prominent local maxima", () => {
    const data = [0, 1, 0, 5, 0, 2, 0];
    expect(findPeaks(data, 0.5)).toEqual([1, 3, 5]);
  });

  it("filters peaks below the prominence threshold", () => {
    const data = [0, 1, 0, 5, 0, 2, 0];
    expect(findPeaks(data, 3)).toEqual([3]);
  });
});

describe("computeNpq / computePhiPsii", () => {
  // Two saturating-pulse peaks on a rising-then-quenched fluo trace.
  const fluo = [0.2, 1.0, 0.3, 0.25, 0.6, 0.2];
  const peaks = [1, 4]; // Fm at idx1 (1.0), Fm' at idx4 (0.6)

  it("computeNpq uses first peak as Fm0", () => {
    const npq = computeNpq(fluo, peaks);
    // (1.0-1.0)/1.0 = 0 ; (1.0-0.6)/0.6
    expect(npq[0]).toBeCloseTo(0, 12);
    expect(npq[1]).toBeCloseTo(0.4 / 0.6, 12);
  });

  it("computeNpq returns empty for no peaks", () => {
    expect(computeNpq(fluo, [])).toEqual([]);
  });

  it("computePhiPsii uses Fo as min before each peak", () => {
    const phi = computePhiPsii(fluo, peaks);
    // peak0: Fm=1.0, Fo=min(idx0..)=0.2 -> 0.8
    expect(phi[0]).toBeCloseTo((1.0 - 0.2) / 1.0, 12);
    // peak1: Fm=0.6, Fo=min between prev peak(1) and idx4 = min(0.3,0.25)=0.25
    expect(phi[1]).toBeCloseTo((0.6 - 0.25) / 0.6, 12);
  });
});
