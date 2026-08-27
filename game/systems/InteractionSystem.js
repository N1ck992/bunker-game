// InteractionSystem.js
//
// Evaluates game/data/interactions.json against the CURRENT party
// composition and reports which interactions are active — nothing in this
// file knows or cares what a "race" is beyond it being a string on
// Character.race, and nothing here is hardcoded to "human" or to any
// specific character. Adding a new race, a new character, or a new
// interaction later is purely a data change (characters.json +
// interactions.json); this engine doesn't need to change to support:
//
//   - same-race interactions (requires.races: ["human","human"])
//   - cross-race interactions (requires.races: ["human","<other race>"])
//   - race-vs-race with no humans involved at all
//   - specific-character interactions (requires.characterIds: [...]),
//     independent of race
//   - interactions between 3+ characters (characterIds/races just list
//     more entries)
//   - whole-squad-level conditions (requires.minPartySize)
//
// At this stage interactions.json ships with an empty "interactions" list
// (per the current design brief: lay the extensible structure, don't
// invent specific bonuses yet) — getActive() will simply return an empty
// array until data is added there, and applyEffect() has no known effect
// types wired up yet (see its own comment) for the same reason. Nothing
// else in the game currently calls this system; it's provided ready for
// whoever wires up the first real interaction later (a UI to display
// getActive(), and/or a system that calls applyEffect() during combat/
// stat calculation).

export class InteractionSystem {
  /** @param {{interactions: object[]}} interactionsData - game/data/interactions.json */
  constructor(interactionsData) {
    this.definitions = interactionsData?.interactions ?? [];
  }

  /**
   * @param {Character[]} partyCharacters - the current squad (however the
   *   caller defines "current" — e.g. Game.characters filtered to
   *   inParty !== false; this system doesn't assume which)
   * @returns {object[]} every interaction definition whose `requires` is
   *   satisfied by this party right now
   */
  getActive(partyCharacters) {
    return this.definitions.filter((def) => this._matches(def.requires, partyCharacters));
  }

  /**
   * True if `requires` (see game/data/interactions.json's schema comment)
   * is fully satisfied by `party`. Every condition present in `requires`
   * must hold — an empty/missing `requires` matches any non-empty party.
   */
  _matches(requires, party) {
    if (!requires) return party.length > 0;

    if (requires.minPartySize != null && party.length < requires.minPartySize) {
      return false;
    }

    if (requires.characterIds) {
      const presentIds = new Set(party.map((c) => c.id));
      if (!requires.characterIds.every((id) => presentIds.has(id))) return false;
    }

    if (requires.races) {
      // Multiset match: e.g. ["human","human"] needs at least two humans;
      // ["human","xeno"] needs at least one of each — counts, not just
      // "this race is present somewhere".
      const neededCounts = new Map();
      for (const race of requires.races) {
        neededCounts.set(race, (neededCounts.get(race) ?? 0) + 1);
      }
      const availableCounts = new Map();
      for (const character of party) {
        availableCounts.set(character.race, (availableCounts.get(character.race) ?? 0) + 1);
      }
      for (const [race, needed] of neededCounts) {
        if ((availableCounts.get(race) ?? 0) < needed) return false;
      }
    }

    return true;
  }

  /**
   * Placeholder dispatcher for whatever an interaction's `effects` entries
   * turn out to look like once real ones are designed — deliberately not
   * implementing any effect `type` yet (per the current brief: structure
   * only, no invented bonuses/penalties). Wiring a real effect later means
   * adding a case here and the matching data in interactions.json, not
   * restructuring this system or Character/CharacterSystem.
   */
  applyEffect(effect, context) {
    // No known effect types yet — intentionally a no-op.
  }
}
