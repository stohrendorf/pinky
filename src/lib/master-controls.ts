export type MasterId = "vol" | "rev" | "tilt";

export interface MasterValues {
  vol: number;
  rev: number;
  tilt: number;
}

export interface MasterTargets {
  volume: AudioParam;
  reverb: AudioParam;
  tiltLow: AudioParam;
  tiltHigh: AudioParam;
}

export interface MasterControlsOptions {
  values: MasterValues;
  targets: () => MasterTargets | null;
  currentTime: () => number;
  rampTo: (
    param: AudioParam,
    value: number,
    at: number,
    duration: number,
    from?: number,
  ) => void;
}

const EPSILON: Record<MasterId, number> = {
  vol: 0.004,
  rev: 0.004,
  tilt: 0.05,
};

const isMasterId = (id: string): id is MasterId =>
  id === "vol" || id === "rev" || id === "tilt";

/** Applies slider and automation commands to the injected master nodes. */
export class MasterControls {
  private readonly values: MasterValues;
  private readonly targets: () => MasterTargets | null;
  private readonly currentTime: () => number;
  private readonly rampTo: MasterControlsOptions["rampTo"];
  // AudioParam.value remains at the graph's base value while a whole offline
  // timeline is queued. Keep each future endpoint so the next ramp is continuous.
  private readonly lastAutomated: Partial<Record<MasterId, number>> = {};

  constructor(options: MasterControlsOptions) {
    this.values = options.values;
    this.targets = options.targets;
    this.currentTime = options.currentTime;
    this.rampTo = options.rampTo;
  }

  apply(id: string, value: number): void {
    if (!isMasterId(id)) {
      return;
    }
    this.values[id] = value;
    this.applyAt(id, value, this.currentTime(), 0.02);
  }

  automate(id: string, value: number, at: number, ramp: number): void {
    if (!isMasterId(id)) {
      return;
    }
    const previous = this.lastAutomated[id];
    if (previous !== undefined && Math.abs(value - previous) <= EPSILON[id]) {
      return;
    }
    this.lastAutomated[id] = value;
    this.applyAt(
      id,
      value,
      at,
      Math.max(0.005, ramp),
      previous ?? this.values[id],
    );
  }

  reset(): void {
    const at = this.currentTime();
    for (const id of ["vol", "rev", "tilt"] as const) {
      this.lastAutomated[id] = this.values[id];
      this.applyAt(id, this.values[id], at, 0.05);
    }
  }

  state(): { vol: number; tilt: number } {
    const targets = this.targets();
    return {
      vol: targets ? targets.volume.value : this.values.vol,
      tilt: targets ? targets.tiltHigh.value : this.values.tilt,
    };
  }

  private applyAt(
    id: MasterId,
    value: number,
    at: number,
    ramp: number,
    from?: number,
  ): void {
    const targets = this.targets();
    if (!targets) {
      return;
    }
    if (id === "vol") {
      this.rampTo(targets.volume, value, at, ramp, from);
    } else if (id === "rev") {
      this.rampTo(targets.reverb, value, at, ramp, from);
    } else {
      this.rampTo(
        targets.tiltLow,
        -value,
        at,
        ramp,
        from === undefined ? undefined : -from,
      );
      this.rampTo(targets.tiltHigh, value, at, ramp, from);
    }
  }
}
