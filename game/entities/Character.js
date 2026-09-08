// Character.js
// Data + small behaviour for a single settler. No rendering code here.
//
// Stat overhaul (Этап 2/3 of the hero+vehicle rework): the old fixed
// attribute list (strength/endurance/agility/intelligence/concentration)
// and the old ability system tied to it (skillId/skillCharge/shieldRemaining,
// see the removed CombatSystem.js/SkillSystem.js) are gone. Combat numbers
// now live in this.stats (see game/systems/StatsSystem.js) — a generic,
// data-driven container, so adding a new stat later is a data change
// (game/data/characters.json), not a change to this class. The actual
// automatic battle system that reads these stats comes in a later stage;
// for now this is just the data foundation.

import { Stats } from '../systems/StatsSystem.js?v=57';

// Used for any base stat characters.json doesn't specify, so a
// half-filled data entry still produces a usable Stats object instead of
// NaNs everywhere. Not a balance decision — just a safe fallback.
const DEFAULT_BASE_STATS = {
  maxHealth: 100,
  attack: 10,
  defense: 0,
  speed: 3,
  attackRange: 1,
  attackSpeed: 1,
  critChance: 0,
  critDamage: 50,
  // Officer/vehicle-wide ability stats (see game/systems/AbilitySystem.js).
  // All three are "percentage points" accumulators, not 0-1 multipliers —
  // an ability granting "+15%" adds a flat +15 to the relevant one of
  // these via a Stats flat modifier (see AbilitySystem.applyPassives), so
  // Stats.get(...) directly returns the total % to use in the (future)
  // damage formula. firepower boosts this unit's own attack; damageIntensity
  // is a further multiplier on top of the final damage number, on any
  // damage type — countered by the target's damageResistance;
  // cooldownReduction shortens ability/attack cooldowns for units this
  // hero commands (squad-wide effect, not just themselves).
  firepower: 0,
  damageIntensity: 0,
  damageResistance: 0,
  cooldownReduction: 0,
  // Armor/penetration/accuracy — same "hero can boost the vehicle's own
  // number" pattern as the four above (see BattleSystem._combinedPercent).
  // A hero's own baseline here is 0 (no built-in armor/pierce/accuracy of
  // their own) — these only matter once a hero's ability/modifier grants
  // some, on top of whatever the vehicle itself brings.
  armor: 0,
  pierce: 0,
  accuracy: 0
};

export class Character {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    // Species/faction — currently only "human" exists, but this is a plain
    // data field on purpose: nothing in Character/CharacterSystem/combat
    // reads or branches on it. It exists so InteractionSystem (see
    // game/systems/InteractionSystem.js and game/data/interactions.json)
    // has something to match against once non-human party members and
    // race-aware interactions actually exist — adding a race later means
    // adding a characters.json entry with a different "race" and maybe
    // some interactions.json data, not touching this class.
    this.race = data.race ?? 'human';
    // Lore faction (see game/data/factions.json / ТЗ п.18) — a plain id
    // string on purpose, same reasoning as `race` above: nothing branches
    // on which faction this is, it's just a tag for future UI/interactions/
    // AI-analysis to key off of. Distinct from `race`: race is the
    // biological/species classification InteractionSystem already reads,
    // faction is the broader lore grouping (обычные/кибернетические/
    // биологически эволюционировавшие люди, and whatever gets added later).
    this.faction = data.faction ?? 'baseline_humans';
    // Free-form role/type tag (e.g. "assault", "support", "recon", ...) —
    // ТЗ п.4's "тип". Not an enum enforced anywhere; purely descriptive
    // metadata for future UI/filtering, same spirit as faction above.
    this.heroType = data.heroType ?? null;
    // Short flavour text for hero-selection/inspection screens (ТЗ п.4).
    this.description = data.description ?? '';
    this.avatar = data.avatar ?? null; // path to portrait art, null falls back to initials in the roster UI
    // Full-body art for the Отряд screen's centre portrait frame (see
    // game/ui/PartyUI.js) — reuses this character's own idle sprite (first
    // frame) rather than needing separate dedicated art, so it's always in
    // sync with whatever's set in "sprites" (see game/data/characters.json).
    // null falls back to a generic placeholder icon there.
    this.fullBodyArt = data.sprites?.idle?.[0] ?? null;

    // Generic combat stat block (see game/systems/StatsSystem.js). Base
    // values come from characters.json's "stats" object; anything omitted
    // falls back to DEFAULT_BASE_STATS above. Future stats (new damage
    // types, resistances, whatever) just need a new key in data — nothing
    // here has to change.
    this.stats = new Stats({ ...DEFAULT_BASE_STATS, ...(data.stats ?? {}) });

    // Current HP, separate from the "maxHealth" stat (which can itself be
    // buffed/debuffed by modifiers) — same pattern Enemy.js uses.
    this.health = data.health ?? this.stats.get('maxHealth');

    // Hero-innate permanent modifiers (ТЗ п.7) — e.g. a hero whose own
    // design says "+15% attack" regardless of gear/vehicle. Declared as
    // data in characters.json ("modifiers": [{stat, type, value}]) and
    // applied once here as permanent (no duration) Stats modifiers tagged
    // with this hero's own id as the source, so they're easy to tell apart
    // from gear/vehicle/ability modifiers layered on top later. Kept as
    // plain data on this.modifiers too (not just inside Stats) so
    // toSaveData can round-trip them — Stats.toJSON() only exports raw
    // base values, not which modifiers produced the current numbers.
    this.modifiers = data.modifiers ?? [];
    for (const mod of this.modifiers) {
      this.stats.addModifier({ ...mod, duration: null, source: `hero:${this.id}` });
    }

    // Ability system hooks (ТЗ п.8) — lists of ability ids this hero has,
    // resolved against game/data/abilities.json by AbilitySystem. Empty by
    // default so every existing hero loads cleanly with no abilities.
    this.activeAbilities = data.activeAbilities ?? [];
    this.passiveAbilities = data.passiveAbilities ?? [];

    // Hero level and per-ability rank — no cap enforced anywhere right now
    // (per explicit request, so any hero/ability can be set straight to
    // its max for testing). AbilitySystem clamps an ability's level to
    // however many tiers its data actually defines, but the hero level
    // itself is just a plain number.
    this.level = data.level ?? 1;
    // abilityId -> current level (1-based). An ability id present in
    // activeAbilities/passiveAbilities with no entry here defaults to
    // level 1 (see AbilitySystem.getAbilityLevel).
    this.abilityLevels = { ...(data.abilityLevels ?? {}) };

    // Freeform bag for anything that doesn't fit the stat/ability model —
    // ТЗ п.4's "специальные свойства" (e.g. "immune to fire", "can open
    // hack doors", ...). Plain data, nothing reads it yet; a future system
    // can check specialProperties.someFlag without this class changing.
    this.specialProperties = data.specialProperties ?? {};

    // Forward-looking hook for hero<->vehicle interaction rules (ТЗ п.6 —
    // "герой способен усиливать технику/менять её поведение"). Left empty
    // until the Vehicle system (next stage) defines what actually goes
    // here; this.vehicle below is just which vehicle item is equipped.
    this.vehicleInteraction = data.vehicleInteraction ?? {};

    this.temperature = data.temperature ?? 20;

    this.clothing = data.clothing ?? null; // equipped clothing item id, or null
    this.weapon = data.weapon ?? null; // equipped weapon item id, or null
    // Equipped transport/vehicle item id, or null. Deliberately its own slot,
    // separate from weapon/clothing: a transport-suit (and later cars,
    // motorcycles, other surface/space suits) is a piece of vehicle
    // technology, not amunition or clothing — see items.json's "vehicle"
    // slot and Game._canTravelWorldMap. This is also the slot the upcoming
    // Vehicle battle system (ТЗ п.5/6) will hang off — a hero's equipped
    // vehicle id here doubles as which combat vehicle they're paired with.
    this.vehicle = data.vehicle ?? null;
    // Equipped gadget/device item id, or null. A third equip slot alongside
    // weapon/vehicle — the "дополнительное устройство" shown in the squad
    // screen (see game/ui/PartyUI.js). No items.json entries use slot
    // "gadget" yet, so this is a forward-looking hook: it always reads as
    // unequipped today, ready to wire up once gadget items exist.
    this.gadget = data.gadget ?? null;
    // Unequipped items are no longer tracked per-character — the whole party
    // shares one backpack now (see Game.partyInventory / InventorySystem).

    // Generic combat runtime state — the contract MovementSystem/EnemySystem/
    // rendering already share (a character "holds position" while
    // combatState === 'attacking' or isBeingAttacked, regardless of which
    // system actually put them in that state). Nothing currently sets
    // combatState to 'attacking' for a hero (the old CombatSystem that did
    // is removed, pending the new Battle System stage) — these fields stay
    // so the rest of the game keeps working unchanged once that system
    // lands, without another pass through Movement/rendering code.
    this.attackCooldownRemaining = 0;
    this.attackCooldownSeconds = 0;
    this.attackAnimRemaining = 0;
    this.attackAnimDuration = 0;
    this.combatState = 'idle'; // 'idle' | 'attacking'
    this.targetEnemyId = null;
    // Whether some enemy is currently attacking this character, refreshed
    // every frame by EnemySystem — separate from combatState, which only
    // tracks this character's own attack. A character under attack
    // holds position even with no weapon equipped or the attacker out of
    // their own weapon's range — see MovementSystem.moveTo.
    this.isBeingAttacked = false;

    // grid position (col,row)
    this.position = { ...(data.position ?? { col: 0, row: 0 }) };

    // 'active' | 'inactive'
    this.state = data.state ?? 'active';

    // Whether this settler has actually joined the party yet. Characters
    // with recruited:false in characters.json are held back from
    // Game.characters (see Game._splitRecruits) and instead shown as a
    // standalone NPC on their home floor (levelId) until a party member
    // walks up to them — see Game._updateRecruitEncounters.
    this.recruited = data.recruited ?? true;
    // Which map (mapData.id) this settler waits on before being recruited.
    // Unused once recruited.
    this.levelId = data.levelId ?? null;

    // Squad management (see game/ui/PartyUI.js): inParty=false means this
    // recruited settler stays out of combat (not targeted by enemies, does
    // not auto-fight) even though they're still walking around the bunker.
    // isTank marks the one settler enemies should prefer to attack first —
    // see EnemySystem._pickTarget.
    this.inParty = data.inParty ?? true;
    this.isTank = data.isTank ?? false;
    // Firing-line stand order behind the tank (see SquadCombatSystem —
    // lower numbers stand closer to the tank, higher/unset ones fall back
    // to roster order). Set from the roster's per-character menu — see
    // CharacterMenuUI's "Очередь" picker / Game._setQueueOrder. Irrelevant
    // for whoever is currently the tank (they're always line 1).
    this.queueOrder = data.queueOrder ?? null;

    // 1 = facing right, -1 = facing left. Used to flip the sprite.
    this.facingDir = data.facingDir ?? 1;

    // 'idle' | 'examine' — drives which placeholder sprite is drawn.
    this.animState = 'idle';

    // AFK fidget runtime state, advanced by Game's _updateCharacterAfk — not
    // saved, same as combatState/animState above.
    this.afkIdleSeconds = 0; // how long they've been truly idle (resets on any activity)
    this.afkPlaying = false; // currently mid-fidget
    this.afkElapsed = 0; // seconds into the current fidget playback

    // movement runtime state (filled in by MovementSystem)
    this.path = [];
    this.moveProgress = 0; // 0..1 progress along current path segment
    this.pixelPosition = null; // set by renderer/movement system
  }

  isCritical() {
    return this.health <= 0 || this.temperature <= 5 || this.temperature >= 45;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.setInactive();
  }

  setInactive() {
    this.state = 'inactive';
    this.path = [];
  }

  setActive() {
    this.state = 'active';
  }

  get isActive() {
    return this.state === 'active';
  }

  toSaveData() {
    return {
      id: this.id,
      name: this.name,
      race: this.race,
      faction: this.faction,
      heroType: this.heroType,
      description: this.description,
      avatar: this.avatar,
      health: this.health,
      stats: this.stats.toJSON(),
      modifiers: this.modifiers,
      activeAbilities: this.activeAbilities,
      passiveAbilities: this.passiveAbilities,
      level: this.level,
      abilityLevels: { ...this.abilityLevels },
      specialProperties: this.specialProperties,
      vehicleInteraction: this.vehicleInteraction,
      temperature: this.temperature,
      clothing: this.clothing,
      weapon: this.weapon,
      vehicle: this.vehicle,
      gadget: this.gadget,
      position: { ...this.position },
      state: this.state,
      recruited: this.recruited,
      levelId: this.levelId,
      inParty: this.inParty,
      isTank: this.isTank,
      queueOrder: this.queueOrder
    };
  }
}
