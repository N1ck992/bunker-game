// AbilitySystem.js
// Reads game/data/abilities.json and turns a hero's declared
// activeAbilities/passiveAbilities + abilityLevels into real numbers:
// passive abilities become permanent Stats modifiers (ТЗ п.7/8), active
// abilities expose their current-level tier (damage coefficient, prep
// time, secondary effect) for whatever reads them next — actually
// dealing damage is the future Battle System's job (Этап 8), this system
// only computes "what would this ability currently do".
//
// Levels are intentionally unrestricted right now, per explicit request:
// no hero-level gating (unlockHeroLevel is stored but never checked here),
// and setAbilityLevel/setHeroLevel accept any value a caller passes — the
// only clamp is against how many tiers an ability's data actually defines
// (can't select a tier that doesn't exist), so "max it out for testing"
// is always just maxOutAllAbilities().

export class AbilitySystem {
  /** @param {Map<string, object>} abilitiesById - game/data/abilities.json entries, keyed by id */
  constructor(abilitiesById) {
    this.abilitiesById = abilitiesById;
  }

  /** Current level of `abilityId` on `character` — 1 if the hero has the ability but no explicit level was ever set. */
  getAbilityLevel(character, abilityId) {
    return character.abilityLevels[abilityId] ?? 1;
  }

  /** How many levels (tiers) `abilityId` actually has data for. */
  maxLevelFor(abilityId) {
    const def = this.abilitiesById.get(abilityId);
    if (!def) return 0;
    return def.tiers?.length ?? 0;
  }

  /** Sets `abilityId`'s level on `character`, clamped to [1, that ability's own max tier] — never below 1, never past however many tiers exist. Re-applies passives immediately so Stats stay in sync. */
  setAbilityLevel(character, abilityId, level) {
    const max = this.maxLevelFor(abilityId);
    if (max === 0) return; // unknown ability id — nothing to set
    character.abilityLevels[abilityId] = Math.max(1, Math.min(level, max));
    this.applyPassives(character);
  }

  /** Sets every ability `character` has (active + passive) straight to its own max level — the "прокачать на максимум для теста" shortcut. */
  maxOutAllAbilities(character) {
    for (const abilityId of [...character.passiveAbilities, ...character.activeAbilities]) {
      const max = this.maxLevelFor(abilityId);
      if (max > 0) character.abilityLevels[abilityId] = max;
    }
    this.applyPassives(character);
  }

  /** Hero level has no cap — set directly to whatever the caller wants. */
  setHeroLevel(character, level) {
    character.level = level;
  }

  /**
   * (Re)applies every passive ability's current-level bonus onto
   * `character.stats` as a flat modifier on `effect.stat`. Removes any
   * previously-applied ability modifiers first (tagged `ability:<id>`),
   * so calling this again after a level change or a save/load never
   * double-stacks the same ability.
   */
  applyPassives(character) {
    for (const abilityId of character.passiveAbilities) {
      character.stats.removeModifiersFrom(`ability:${abilityId}`);
      const def = this.abilitiesById.get(abilityId);
      if (!def || def.type !== 'passive') continue;

      const level = this.getAbilityLevel(character, abilityId);
      const tierIndex = Math.max(0, Math.min(level, def.tiers.length) - 1);
      const value = def.tiers[tierIndex];

      character.stats.addModifier({
        stat: def.effect.stat,
        type: 'flat',
        value,
        duration: null,
        source: `ability:${abilityId}`
      });
    }
  }

  /**
   * Whether `abilityId` (an active ability on `character`) should use its
   * "awakened" variant right now — true once that ability's own level AND
   * every other ability this hero has (active or passive) are all at
   * their own individual max level. Matches the source material's
   * "доступно, когда все другие навыки достигнут макс. уровня".
   */
  isAwakened(character, abilityId) {
    const def = this.abilitiesById.get(abilityId);
    if (!def?.awakened) return false;

    const allAbilityIds = [...character.passiveAbilities, ...character.activeAbilities];
    return allAbilityIds.every((id) => {
      const max = this.maxLevelFor(id);
      return max > 0 && this.getAbilityLevel(character, id) >= max;
    });
  }

  /**
   * The currently-active tier data for an active ability on `character` —
   * the awakened tier's last entry if isAwakened(), otherwise the normal
   * tier matching the ability's current level. Returns null for an
   * unknown/non-active ability id.
   */
  getActiveTier(character, abilityId) {
    const def = this.abilitiesById.get(abilityId);
    if (!def || def.type !== 'active') return null;

    if (this.isAwakened(character, abilityId)) {
      const awakenedTiers = def.awakened.tiers;
      return { ...awakenedTiers[awakenedTiers.length - 1], prepSeconds: def.awakened.prepSeconds, awakened: true };
    }

    const level = this.getAbilityLevel(character, abilityId);
    const tierIndex = Math.max(0, Math.min(level, def.tiers.length) - 1);
    return { ...def.tiers[tierIndex], prepSeconds: def.prepSeconds, awakened: false };
  }
}
