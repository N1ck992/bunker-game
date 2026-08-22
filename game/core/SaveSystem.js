// SaveSystem.js
// Local save using localStorage (spec section 27 - fine for the first prototype;
// swap the two methods below for IndexedDB later without touching call sites).

const SAVE_KEY = 'bunker_prototype_save_v2'; // bumped: v1 saves predate the current map/roster and are no longer valid

export class SaveSystem {
  save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error('[SaveSystem] failed to save:', err);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('[SaveSystem] failed to load:', err);
      return null;
    }
  }

  hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null;
  }

  clear() {
    localStorage.removeItem(SAVE_KEY);
  }
}
