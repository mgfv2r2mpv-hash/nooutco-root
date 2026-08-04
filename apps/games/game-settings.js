/* ════════════════════════════════════════════════════════════════════
   game-settings.js - the shared clinical settings store (Stage 6)

   Extracted verbatim in behaviour from the `sequences` round-setup pattern
   (sequences/index.html Frame 04, sequences/game.js). Three pieces, and only
   these three, because they are the three every game needs and nothing more:

     1. the `{ sets, last, working }` store schema, persisted device-local
     2. `normalize()` - declarative clamping that keeps a saved config
        resilient to content and version changes
     3. `holdToUnlock()` - press-and-hold-the-gear gating, so a learner
        tapping the gear cannot change a running programme's parameters

   Plus the one migration primitive Stage 6 turns on: `foldLegacy()`, which
   reads a game's retired settings key and folds it into the store as the
   working config. READ-THEN-FOLD, NEVER DROP - the legacy key is never
   deleted and never overwritten, so a fold that gets the mapping wrong is
   recoverable and a downgrade still finds the old configuration intact.

   Clinical note: these are programme parameters, not preferences. No field
   is ever removed or silently redefaulted here - an out-of-range value is
   clamped into range and an absent one takes the field's declared default,
   both of which are visible in the panel the technician is looking at.

   Usage:
     const store = NooutcoSettings.defineStore({
       key: 'nooutco.settings.<game>',
       legacyKey: '<game>Settings',
       fields: {
         reps:  { type: 'int',  min: 1, max: 10, default: 2 },
         sound: { type: 'bool', default: true },
         style: { type: 'enum', values: ['sparkle', 'outline'], default: 'sparkle' },
         sets:  { type: 'list', values: () => Object.keys(TEMPLATES), default: ['AB'] },
         name:  { type: 'string', default: '' },
         // topic -> the stimulus URLs chosen as targets; keys and values are
         // both content, so a `map` is kept verbatim rather than validated.
         targetFilters: { type: 'map', default: {} },
       },
     });
     const cfg = store.initial();          // working ?? last saved set ?? defaults
     store.saveWorking(cfg);               // persist live edits
   ════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /** Resolve a field option that may be given as a value or as a thunk. */
  function resolve(v, cfg) {
    return typeof v === 'function' ? v(cfg) : v;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /**
   * Integer clamping, matching sequences' clampReps/clampInt: an unparseable
   * (or zero) value falls back to the field's declared default rather than to
   * the minimum, so a corrupted 0 restores the programme's default of 4 rather
   * than quietly moving the technician to the floor of the range.
   */
  function normalizeInt(raw, field, cfg) {
    var def = resolve(field.default, cfg);
    var lo  = field.min == null ? -Infinity : resolve(field.min, cfg);
    var hi  = field.max == null ? Infinity  : resolve(field.max, cfg);
    var n   = parseInt(raw, 10) || def;
    return clamp(n, lo, hi);
  }

  function normalizeBool(raw, field, cfg) {
    return (raw == null) ? !!resolve(field.default, cfg) : !!raw;
  }

  function normalizeEnum(raw, field, cfg) {
    var values = resolve(field.values, cfg) || [];
    var allowed = Array.isArray(values) ? values : Object.keys(values);
    return allowed.indexOf(raw) >= 0 ? raw : resolve(field.default, cfg);
  }

  function normalizeString(raw, field, cfg) {
    return (typeof raw === 'string' && raw !== '') ? raw : String(resolve(field.default, cfg) || '');
  }

  /**
   * A list of allowed members. Unknown members are dropped (content changed
   * under a saved set); an empty result takes the declared default, because
   * "no patterns selected" is not a runnable programme.
   */
  function normalizeList(raw, field, cfg) {
    var values = resolve(field.values, cfg) || [];
    var allowed = Array.isArray(values) ? values : Object.keys(values);
    var out = Array.isArray(raw) ? raw.filter(function (v) { return allowed.indexOf(v) >= 0; }) : [];
    if (!out.length) out = (resolve(field.default, cfg) || []).slice();
    return out;
  }

  /**
   * An opaque technician-keyed object. `targetFilters` is the live case:
   * `{ 'T_animals': ['/shared/stimuli/img/T_animals/bear.jpg', …] }`.
   *
   * Unlike `list`, BOTH its keys and its values are content rather than schema,
   * so there is no allowed set to validate against and nothing may be dropped - * a topic whose art is temporarily unavailable must still come back carrying
   * the targets the technician chose for it. Only a value that is not a plain
   * object at all (a string, an array, null) falls back to the default.
   */
  function normalizeMap(raw, field, cfg) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      var def = resolve(field.default, cfg);
      return (def && typeof def === 'object') ? clone(def) : {};
    }
    return clone(raw);
  }

  var NORMALIZERS = {
    int:    normalizeInt,
    bool:   normalizeBool,
    enum:   normalizeEnum,
    string: normalizeString,
    list:   normalizeList,
    map:    normalizeMap,
  };

  function defaultsFor(fields) {
    var out = {};
    Object.keys(fields).forEach(function (name) {
      var field = fields[name];
      var def = resolve(field.default, {});
      // A declared array/object default is shared by reference across every
      // call otherwise, so one game's live edit would mutate the declaration.
      out[name] = (def && typeof def === 'object') ? clone(def) : def;
    });
    return out;
  }

  function normalizeWith(fields, cfg) {
    var src = cfg || {};
    var out = {};
    Object.keys(fields).forEach(function (name) {
      var field = fields[name];
      var fn = NORMALIZERS[field.type];
      if (!fn) throw new Error('game-settings: unknown field type "' + field.type + '" for ' + name);
      out[name] = fn(src[name], field, src);
    });
    return out;
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /**
   * Build a store bound to one localStorage key.
   *
   * @param {{key:string, legacyKey?:string, fields:Object}} spec
   */
  function defineStore(spec) {
    if (!spec || !spec.key) throw new Error('game-settings: a store needs a key');
    var fields = spec.fields || {};
    var KEY = spec.key;

    function load() {
      var raw;
      try { raw = global.localStorage.getItem(KEY); }
      catch (e) { return {}; }
      try {
        var parsed = JSON.parse(raw || '{}');
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
      } catch (e) { return {}; }
    }

    function save(store) {
      try { global.localStorage.setItem(KEY, JSON.stringify(store)); }
      catch (e) { /* storage full / unavailable - non-fatal */ }
    }

    function defaults() { return defaultsFor(fields); }

    function normalize(cfg) { return normalizeWith(fields, cfg); }

    /** Persist live panel edits so a reload restores exactly what was on screen. */
    function saveWorking(cfg) {
      var store = load();
      store.working = clone(cfg);
      save(store);
      return store;
    }

    function setNames(store) {
      return Object.keys((store || load()).sets || {});
    }

    /** Save the current config under a technician-chosen pseudonymous name. */
    function saveSet(name, cfg) {
      var store = load();
      store.sets = store.sets || {};
      store.sets[name] = clone(cfg);
      store.last = name;
      save(store);
      return store;
    }

    /** Adopt a saved set by name; returns null when the name is unknown. */
    function applySet(name) {
      var store = load();
      var set = store.sets && store.sets[name];
      if (!set) return null;
      store.last = name;
      save(store);
      return normalize(set);
    }

    /**
     * One-time fold of a retired settings key into the store.
     *
     * Read-then-fold, never drop:
     *   - refuses once a working config exists (the game has been configured
     *     under the new store, so the legacy payload is stale)
     *   - runs at most once, recorded as `_legacyMigrated`
     *   - NEVER removes or rewrites the legacy key
     *
     * @param {{key?:string, map?:Function, base?:Object}} [opts]
     * @returns {Object|null} the folded working config, or null if nothing folded
     */
    function foldLegacy(opts) {
      var o = opts || {};
      var legacyKey = o.key || spec.legacyKey;
      if (!legacyKey) return null;

      var store = load();
      if (store.working || store._legacyMigrated) return null;

      var legacy = null;
      try { legacy = JSON.parse(global.localStorage.getItem(legacyKey) || 'null'); }
      catch (e) { legacy = null; }
      if (!legacy || typeof legacy !== 'object') return null;

      var base = o.base
        || (store.last && store.sets && store.sets[store.last])
        || defaults();
      var mapped = o.map ? o.map(legacy) : legacy;
      var merged = {};
      Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
      Object.keys(mapped || {}).forEach(function (k) { merged[k] = mapped[k]; });

      store.working = normalize(merged);
      store._legacyMigrated = true;
      save(store);
      return store.working;
    }

    /**
     * The config a game boots with: the working config if there is one, else
     * the last saved set, else the declared defaults - always normalized.
     */
    function initial(fallback) {
      var store = load();
      var source = store.working
        || (store.last && store.sets && store.sets[store.last])
        || fallback
        || defaults();
      return normalize(source);
    }

    return {
      key: KEY,
      legacyKey: spec.legacyKey || null,
      fields: fields,
      load: load,
      save: save,
      defaults: defaults,
      normalize: normalize,
      saveWorking: saveWorking,
      setNames: setNames,
      saveSet: saveSet,
      applySet: applySet,
      foldLegacy: foldLegacy,
      initial: initial,
    };
  }

  /**
   * Press-and-hold-to-unlock gating for a settings gear.
   *
   * A quick tap toggles the panel in its locked (read-only) state; holding for
   * `holdMs` opens it unlocked. The learner is sitting in front of the screen,
   * so an accidental tap must never be able to change a running programme's
   * parameters.
   *
   * @param {Element} gear
   * @param {{holdMs?:number, holdingClass?:string, onHold:Function, onTap:Function}} opts
   * @returns {{cancel:Function}}
   */
  function holdToUnlock(gear, opts) {
    var o = opts || {};
    var holdMs = o.holdMs == null ? 600 : o.holdMs;
    var holdingClass = o.holdingClass || 'is-holding';
    var timer = null;
    var didHold = false;

    function endHold() {
      gear.classList.remove(holdingClass);
      if (timer) { clearTimeout(timer); timer = null; }
    }

    gear.addEventListener('pointerdown', function () {
      didHold = false;
      gear.classList.add(holdingClass);
      timer = setTimeout(function () {
        didHold = true;
        gear.classList.remove(holdingClass);
        timer = null;
        if (o.onHold) o.onHold();
      }, holdMs);
    });
    gear.addEventListener('pointerup', endHold);
    gear.addEventListener('pointerleave', endHold);
    gear.addEventListener('pointercancel', endHold);
    gear.addEventListener('click', function () {
      // The hold already opened it - swallow the click that follows the release.
      if (didHold) { didHold = false; return; }
      if (o.onTap) o.onTap();
    });

    return { cancel: endHold };
  }

  global.NooutcoSettings = {
    defineStore: defineStore,
    holdToUnlock: holdToUnlock,
    // Exposed for games that clamp outside a store (and for the spec).
    clampInt: function (n, min, max, def) {
      return clamp(parseInt(n, 10) || (def == null ? min : def), min, max);
    },
  };
})(window);
