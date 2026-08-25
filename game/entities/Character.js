// Character.js
// Data + small behaviour for a single settler. No rendering code here.

export class Character {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.avatar = data.avatar ?? null; // path to portrait art, null falls back to initials in the roster UI
    // Full-body art for the Отряд screen's centre portrait frame (see
    // game/ui/PartyUI.js) — reuses this character's own idle sprite (first
    // frame) rather than needing separate dedicated art, so it's always in
    // sync with whatever's set in "sprites" (see game/data/characters.json).
    // null falls back to a generic placeholder icon there.
    this.fullBodyArt = data.sprites?.idle?.[0] ?? null;

    this.health = data.health ?? 100;
    this.strength = data.strength ?? 5;
    this.endurance = data.endurance ?? 5;
    this.agility = data.agility ?? 5;
    this.intelligence = data.intelligence ?? 5;

    this.temperature = data.temperature ?? 20;

    this.clothing = data.clothing ?? null; // equipped clothing item id, or null
    this.weapon = data.weapon ?? null; // equipped weapon item id, or null
    // Equipped transport/vehicle item id, or null. Deliberately its own slot,
    // separate from weapon/clothing: a transport-suit (and later cars,
    // motorcycles, other surface/space suits) is a piece of vehicle
    // technology, not amunition or clothing — see items.json's "vehicle"
    // slot and Game._canTravelWorldMap.
    this.vehicle = data.vehicle ?? null;
    // Equipped gadget/device item id, or null. A third equip slot alongside
    // weapon/vehicle — the "дополнительное устройство" shown in the squad
    // screen (see game/ui/PartyUI.js). No items.json entries use slot
    // "gadget" yet, so this is a forward-looking hook: it always reads as
    // unequipped today, ready to wire up once gadget items exist.
    this.gadget = data.gadget ?? null;
    // Unequipped items are no longer tracked per-character — the whole party
    // shares one backpack now (see Game.partyInventory / InventorySystem).

    // Combat runtime state, advanced by CombatSystem — not saved (recomputed
    // fresh every load, same as Enemy's attackCooldownRemaining/aiState).
    this.attackCooldownRemaining = 0;
    // The current effective cooldown (weapon base cooldown, sped up by
    // ловкость for melee weapons) — recomputed every frame by CombatSystem.
    // Game._renderCharacters divides attackCooldownRemaining by this to
    // draw the reload bar over the character's head.
    this.attackCooldownSeconds = 0;
    // Brief pulse set by CombatSystem each time a shot/swing actually
    // lands — attack sprite frames only play while this is running, so a
    // slow-firing weapon doesn't read as attacking nonstop; the rest of
    // the cooldown shows an idle "ready" pose plus the reload bar above.
    this.attackAnimRemaining = 0;
    // The pulse's total length at the moment it started (set alongside
    // attackAnimRemaining above) — Game._renderCharacters uses
    // attackAnimDuration - attackAnimRemaining as elapsed-into-the-swing so
    // the attack frames always play draw→fire→recover in order from frame 0,
    // instead of sampling off the absolute game clock (which used to land
    // mid-cycle depending on when the swing happened to fire).
    this.attackAnimDuration = 0;
    this.combatState = 'idle'; // 'idle' | 'attacking'
    this.targetEnemyId = null;
    // Whether some enemy is currently attacking this character, refreshed
    // every frame by EnemySystem — separate from combatState, which only
    // tracks this character's own weapon fire. A character under attack
    // holds position even with no weapon equipped or the attacker out of
    // their own weapon's range — see MovementSystem.moveTo.
    this.isBeingAttacked = false;

    // grid position (col,row)
    this.position = { ...(data.position ?? { col: 0, row: 0 }) };

    this.assignedRoom = data.assignedRoom ?? null;

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
      avatar: this.avatar,
      health: this.health,
      strength: this.strength,
      endurance: this.endurance,
      agility: this.agility,
      intelligence: this.intelligence,
      temperature: this.temperature,
      clothing: this.clothing,
      weapon: this.weapon,
      vehicle: this.vehicle,
      gadget: this.gadget,
      position: { ...this.position },
      assignedRoom: this.assignedRoom,
      state: this.state,
      recruited: this.recruited,
      levelId: this.levelId,
      inParty: this.inParty,
      isTank: this.isTank,
      queueOrder: this.queueOrder
    };
  }
}
