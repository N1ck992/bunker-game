// GameTime.js
// Accelerated day/night cycle: 15 real minutes day, 15 real minutes night (configurable).

export class GameTime {
  constructor(balance, initial = {}) {
    this.dayDurationSeconds = balance.time.dayDurationSeconds;
    this.nightDurationSeconds = balance.time.nightDurationSeconds;

    this.phase = initial.phase ?? 'day'; // 'day' | 'night'
    this.elapsedInPhase = initial.elapsedInPhase ?? 0; // seconds
    this.totalElapsed = initial.totalElapsed ?? 0; // seconds, for save/debug
    this.listeners = [];
  }

  onPhaseChange(cb) {
    this.listeners.push(cb);
  }

  /** @param {number} dtSeconds */
  update(dtSeconds) {
    this.elapsedInPhase += dtSeconds;
    this.totalElapsed += dtSeconds;

    const phaseDuration = this.phase === 'day' ? this.dayDurationSeconds : this.nightDurationSeconds;

    if (this.elapsedInPhase >= phaseDuration) {
      this.elapsedInPhase -= phaseDuration;
      this.phase = this.phase === 'day' ? 'night' : 'day';
      this.listeners.forEach((cb) => cb(this.phase));
    }
  }

  get progress() {
    const phaseDuration = this.phase === 'day' ? this.dayDurationSeconds : this.nightDurationSeconds;
    return this.elapsedInPhase / phaseDuration;
  }

  get isDay() {
    return this.phase === 'day';
  }

  toSaveData() {
    return {
      phase: this.phase,
      elapsedInPhase: this.elapsedInPhase,
      totalElapsed: this.totalElapsed
    };
  }
}
