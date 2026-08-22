// CharacterSystem.js
// Owns need decay (hunger/thirst) and the active/inactive state machine
// described in spec section 14. Does not implement death.

export class CharacterSystem {
  constructor(balance) {
    this.cfg = balance.needs;
    this.selectedId = null;
  }

  select(characterId) {
    this.selectedId = characterId;
  }

  deselect() {
    this.selectedId = null;
  }

  getSelected(characters) {
    return characters.find((c) => c.id === this.selectedId) ?? null;
  }

  /** Called on the slower "needs" tick, not every frame. */
  applyNeedsTick(characters, temperatureSystem) {
    for (const character of characters) {
      character.hunger = Math.max(0, character.hunger - this.cfg.hungerDecayPerTick);
      character.thirst = Math.max(0, character.thirst - this.cfg.thirstDecayPerTick);

      const outOfSafeTemp = character.temperature < 10 || character.temperature > 32;
      const critical =
        character.hunger <= this.cfg.criticalThreshold ||
        character.thirst <= this.cfg.criticalThreshold ||
        outOfSafeTemp;

      if (critical) {
        character.health = Math.max(0, character.health - this.cfg.healthLossWhenCritical);
      }

      if (character.health <= 0 || critical && character.health <= this.cfg.healthLossWhenCritical) {
        // Only flip to inactive once health has actually bottomed out from criticality,
        // not on the very first critical tick — gives the player a moment to react.
      }

      if (character.health <= 0) {
        character.setInactive();
      } else if (
        character.state === 'inactive' &&
        character.hunger > this.cfg.criticalThreshold &&
        character.thirst > this.cfg.criticalThreshold &&
        !outOfSafeTemp &&
        character.health > 20
      ) {
        character.setActive();
      }
    }
  }
}
