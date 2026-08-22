// Character.js
// Data + small behaviour for a single settler. No rendering code here.

export class Character {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.avatar = data.avatar ?? null; // path to portrait art, null falls back to initials in the roster UI

    this.health = data.health ?? 100;
    this.strength = data.strength ?? 5;
    this.endurance = data.endurance ?? 5;
    this.agility = data.agility ?? 5;
    this.intelligence = data.intelligence ?? 5;

    this.hunger = data.hunger ?? 100;
    this.thirst = data.thirst ?? 100;
    this.temperature = data.temperature ?? 20;

    this.clothing = data.clothing ?? null; // equipped clothing item id, or null
    this.weapon = data.weapon ?? null; // equipped weapon item id, or null
    this.inventory = data.inventory ? [...data.inventory] : []; // owned item ids NOT currently equipped

    // Combat runtime state, advanced by CombatSystem — not saved (recomputed
    // fresh every load, same as Enemy's attackCooldownRemaining/aiState).
    this.attackCooldownRemaining = 0;
    this.combatState = 'idle'; // 'idle' | 'attacking'
    this.targetEnemyId = null;

    // grid position (col,row)
    this.position = { ...(data.position ?? { col: 0, row: 0 }) };

    this.assignedRoom = data.assignedRoom ?? null;

    // 'active' | 'inactive'
    this.state = data.state ?? 'active';

    // 1 = facing right, -1 = facing left. Used to flip the sprite.
    this.facingDir = data.facingDir ?? 1;

    // 'idle' | 'examine' — drives which placeholder sprite is drawn.
    this.animState = 'idle';

    // movement runtime state (filled in by MovementSystem)
    this.path = [];
    this.moveProgress = 0; // 0..1 progress along current path segment
    this.pixelPosition = null; // set by renderer/movement system
  }

  isCritical(criticalThreshold) {
    return (
      this.health <= 0 ||
      this.hunger <= criticalThreshold ||
      this.thirst <= criticalThreshold ||
      this.temperature <= 5 ||
      this.temperature >= 45
    );
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
      hunger: this.hunger,
      thirst: this.thirst,
      temperature: this.temperature,
      clothing: this.clothing,
      weapon: this.weapon,
      inventory: [...this.inventory],
      position: { ...this.position },
      assignedRoom: this.assignedRoom,
      state: this.state
    };
  }
}
