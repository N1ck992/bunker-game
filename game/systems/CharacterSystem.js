// CharacterSystem.js
// Owns the active/inactive state machine described in spec section 14.
// Does not implement death. Provisions/hunger/thirst no longer factor in
// here — health only ticks down from unsafe temperature now (see
// applyNeedsTick).

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

  /**
   * Called on the slower "needs" tick, not every frame. Temporarily a
   * no-op — temperature's effect on health is disabled for now (see
   * Game._update's TEMPERATURE_ENABLED) so the mechanic doesn't need to be
   * balanced/tested yet. The health-loss logic itself is left commented
   * below rather than deleted, so it's a one-line uncomment to bring back
   * once temperature actually changes over time again.
   */
  applyNeedsTick(characters, temperatureSystem) {
    // for (const character of characters) {
    //   const outOfSafeTemp = character.temperature < 10 || character.temperature > 32;
    //
    //   if (outOfSafeTemp) {
    //     character.health = Math.max(0, character.health - this.cfg.healthLossWhenCritical);
    //   }
    //
    //   if (character.health <= 0) {
    //     character.setInactive();
    //   } else if (character.state === 'inactive' && !outOfSafeTemp && character.health > 20) {
    //     character.setActive();
    //   }
    // }
  }
}
