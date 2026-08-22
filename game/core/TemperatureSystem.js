// TemperatureSystem.js
// Temperature = f(time of day, depth, heat sources, distance from heat sources)
// This system is intentionally standalone so the numbers can be tuned via balance.json.

export class TemperatureSystem {
  constructor(balance) {
    this.cfg = balance.temperature;
  }

  surfaceTemperature(gameTime) {
    const { surfaceDay, surfaceNight } = this.cfg;
    // Smoothly interpolate across the phase so it doesn't jump instantly.
    const t = gameTime.progress;
    if (gameTime.isDay) {
      // ramps up through the day then eases toward night value at the very end
      return surfaceDay - (surfaceDay - surfaceNight) * Math.max(0, t - 0.8) / 0.2;
    }
    return surfaceNight + (surfaceDay - surfaceNight) * Math.max(0, t - 0.8) / 0.2;
  }

  /**
   * @param {number} depth - negative integer, e.g. -1, -2
   * @param {number} distanceFromHeatSource - grid distance (Infinity if none)
   * @param {GameTime} gameTime
   */
  roomTemperature(depth, distanceFromHeatSource, gameTime) {
    const surface = this.surfaceTemperature(gameTime);
    const depthOffset = depth * this.cfg.depthModifierPerLevel; // depth is negative -> cooler

    let heatBonus = 0;
    if (distanceFromHeatSource <= this.cfg.heatSourceRadius) {
      const falloff = 1 - distanceFromHeatSource / this.cfg.heatSourceRadius;
      heatBonus = this.cfg.heatSourceStrength * falloff;
    }

    return surface + depthOffset + heatBonus;
  }

  isSafe(temperature) {
    return temperature >= this.cfg.safeMin && temperature <= this.cfg.safeMax;
  }
}
