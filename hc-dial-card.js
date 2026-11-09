/*
 * HC Dial Card – a round wall-thermostat card for any Home Assistant climate entity.
 *
 * View: room temperature, target, status icons, clock.
 * Long press on the display → SET mode; turn the outer ring (or use the mouse wheel / arrow keys) to change
 * the target; long press again → save. Nothing is sent while turning. After `timeout` seconds without
 * interaction the card leaves SET mode without saving.
 *
 * Config:
 *   type: custom:hc-dial-card
 *   entity: climate.living_room          (required)
 *   decision: sensor.x                   (optional: HC Thermostat decision sensor – demand bars, window)
 *   heating: binary_sensor.x             (optional: real burner / compressor state)
 *   steps: power draw (power) in thirds of power_max, else the thermostat's demand – HC Thermostat demand,
 *          Versatile power_percent / on_percent, Smart Thermostat control_output (≤10 % one, ≤30 % two, above
 *          three) – else all three while heating or cooling
 *   power: sensor.x                      (optional: power draw in W – the three steps are thirds of power_max;
 *                                         power_max: 1800, power_idle: 40)
 *   heat_type: auto                      (icon of the heat: gas_boiler, floor, radiator, heat_pump, air_conditioner,
 *                                         electric, stove, district, solar, flame; auto = the thermostat's heat_type
 *                                         attribute, else air_conditioner if it can cool, else gas_boiler)
 *   weather: weather.home                (optional)
 *   outdoor: sensor.outdoor_temperature  (optional)
 *   humidity: sensor.x                   (optional; falls back to the entity's current_humidity)
 *   window: binary_sensor.x or a list    (optional; otherwise the window_open/door_open attribute or the HC decision)
 *   step: 0.5                            (target step; default: the entity's target_temp_step)
 *   label: LIVING                        (text before the temperature, max 6 chars; none → no label)
 *   label: area                          (the shown thermostat's HA area; "auto" = the room you are in;
 *                                         area_labels: {Living Room: LIVING} abbreviations)
 *   follow:                              (optional room following: room sensor of the viewing HA user's phone
 *     Anna: sensor.anna_phone_area         – Bermuda area sensor etc.; a single sensor also works: follow: sensor.x)
 *   rooms:                               (room → thermostat; room name or area_id)
 *     Terrace: climate.terrace_ac        (or an object: {entity, label, step, heating, humidity, window, decision})
 *     While following: listed room → its thermostat; other room → the main one (entity); no room
 *     (unknown/not_home) → keep the last one for away_hold seconds, then the main one. No switching in SET mode.
 *     Several thermostats in one room: a list, e.g. [{entity: climate.bedroom_trv, trv: true}, climate.bedroom_ac] →
 *     the one that is on (for a TRV the main thermostat – entity or on_by – decides); otherwise the first.
 *   room_map: {living_room: Living Room} (followed value → room, e.g. ESPresense room or Wi-Fi BSSID)
 *   preset_menu: true                    (tap on the preset icon → choose a preset; HC Thermostat also tells how long it lasts)
 *   control: auto                        (control type at the top left: TPI, PID, HIST, BT, SAT·PWM …; own text, or false = none)
 *   follow_choices: [sensor.x]           (extra beacons for the device menu; Bermuda area sensors appear automatically)
 *   away_states: [unknown, not_home, …]  (values that mean "no room")
 *   follow_app_only: true                (follow only inside the Companion app; browsers show the main thermostat)
 *   tap_action: auto                     (auto: several thermostats → double tap cycles, one → tap opens more-info |
 *                                         more-info | cycle (double tap) | none)
 *   manage: true                         (thermostat icon for admins: list the recognised thermostats / TRVs, long press
 *                                         adds or removes one – saved into this card's rooms on the dashboard)
 *   switch_back: 10                      (s; after picking another thermostat by double tap, return to the room's one)
 *   away_hold: 60                        (s; phone not seen for this long → main thermostat)
 *   timeout: 15                          (s)
 *   step_angle: 18                       (ring degrees per step)
 *
 * A tap outside the ring closes an open menu at once and brings back the room's (main) thermostat.
 * Device menu: long press on the outer ring in view mode – which beacon this device follows (browser storage).
 * Several thermostats (entity + all thermostats in rooms): a double tap on the display shows the next one.
 * Thermostat list (admins): tap the thermostat icon → the recognised climate entities; tap = select, long press =
 * add to / remove from the card (added under the thermostat's HA area in rooms; TRVs with trv: true).
 * SET mode: power button (ON/OFF), saved together with the target by the long press.
 * Range thermostats (target_temp_low/high, e.g. Better Thermostat heat_cool): in SET mode a short tap switches
 * between the lower (heating) and the upper (cooling) target.
 */
const HC_DIAL_VERSION = "1.13.0";
const MODE_ICON = {
  heat: ["mdi:fire", "#ff7a1a"], cool: ["mdi:snowflake", "#2f8cff"], heat_cool: ["mdi:sun-snowflake-variant", "#8e6cf0"],
  auto: ["mdi:thermostat-auto", "#3bb54a"], dry: ["mdi:water-percent", "#26a69a"], fan_only: ["mdi:fan", "#00acc1"],
  off: ["mdi:power", "#444"],
};
// Kind of heat → [icon, colour] for heating (and cooling where the device cools). Chosen by the card's
// heat_type, else the thermostat's heat_type attribute (HC Thermostat publishes it), else guessed:
// a thermostat that can cool is an air conditioner, anything else a boiler.
const HEAT_TYPE = {
  // mode: the mode dot (what kind of heat), run: the second icon (what is working now)
  gas_boiler: { mode: ["mdi:heat-wave", "#ff3b30"], run: ["mdi:fire", "#ff8a1f"] },
  floor: { mode: ["mdi:heating-coil", "#ff5a1f"], run: ["mdi:fire", "#ff8a1f"] },
  radiator: { mode: ["mdi:radiator", "#ff5a1f"], run: ["mdi:valve-open", "#ff8a1f"] },
  heat_pump: { mode: ["mdi:heat-pump", "#ff7a1a"], run: ["mdi:fan", "#ff8a1f"], cool: ["mdi:heat-pump", "#2f8cff"], coolRun: ["mdi:fan", "#4fb3ff"] },
  air_conditioner: { mode: ["mdi:sun-snowflake-variant", "#ff7a1a"], run: ["mdi:fan", "#ff8a1f"], cool: ["mdi:sun-snowflake-variant", "#2f8cff"], coolRun: ["mdi:fan", "#4fb3ff"] },
  electric: { mode: ["mdi:flash", "#ffb300"], run: ["mdi:flash", "#ffb300"] },
  stove: { mode: ["mdi:fireplace", "#ff5a1f"], run: ["mdi:fire", "#ff8a1f"] },
  district: { mode: ["mdi:water-thermometer", "#ff3b30"], run: ["mdi:pump", "#ff8a1f"] },
  solar: { mode: ["mdi:solar-power-variant", "#ffb300"], run: ["mdi:pump", "#ffb300"] },
  flame: { mode: ["mdi:fire", "#ff7a1a"], run: ["mdi:fire", "#ff8a1f"] },
};
const HEAT_TYPES = ["auto", ...Object.keys(HEAT_TYPE)];
// hvac_action → [icon, colour] shown in place of the flame / bars
const ACTION_ICON = {
  heating: ["mdi:fire", "#ff8a1f"], cooling: ["mdi:snowflake", "#4fb3ff"], preheating: ["mdi:fire-alert", "#ffb74d"],
  defrosting: ["mdi:snowflake-melt", "#80deea"], drying: ["mdi:water-percent", "#26a69a"], fan: ["mdi:fan", "#00acc1"],
};
const pOffAria = (c) => (c._pOn === false ? c._t("off") : `${c._fmt(c._pending)} ${c._unit()}`);
// ClimateEntityFeature
const F_TEMP = 1, F_RANGE = 2, F_PRESET = 16, F_OFF = 128, F_ON = 256;
// accent-, case- and separator-insensitive comparison
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s_-]+/g, "_");
const WEATHER_ICON = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", fog: "mdi:weather-fog",
  hail: "mdi:weather-hail", lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant", exceptional: "mdi:alert-circle-outline",
};

// preset → [icon, colour]; "none" / empty preset is not shown
const PRESET_ICON = {
  eco: ["mdi:leaf", "#7bc043"], away: ["mdi:home-export-outline", "#90a4ae"], vacation: ["mdi:palm-tree", "#ffb300"],
  sleep: ["mdi:bed", "#9fa8da"], night: ["mdi:weather-night", "#9fa8da"], comfort: ["mdi:sofa", "#ff8a65"],
  home: ["mdi:home", "#4fc3f7"], boost: ["mdi:rocket-launch", "#ff5252"], activity: ["mdi:run", "#ffd54f"],
  auto: ["mdi:calendar-clock", "#81c784"],
};
// UI strings per language; unknown languages fall back to English.
const STR = {
  hu: {
    days: ["VAS", "HÉT", "KED", "SZE", "CSÜ", "PÉN", "SZO"], target: "CÉL", now: "most", was: "volt", on: "BE", off: "KI",
    heat: "FŰTÉS", cool: "HŰTÉS", unavailable: "Nem elérhető", saved: "Rögzítve", unchanged: "Nem változott",
    error: "Hiba – nem mentve", shadow: "Árnyék mód: nem kapcsol",
    hintRange: "Gyűrű: állít · koppintás: fűt/hűt · gomb: be/ki · hosszan: rögzít",
    hint: "Gyűrű: állít · gomb: be/ki · hosszan: rögzít",
    menuTitle: "Ez a készülék követi:", menuDefault: "Alapbeállítás", menuNone: "Nem követ", menuClose: "Bezár",
    listTitle: "Termosztátok a kártyán", listHint: "koppintás: kijelöl · hosszan: hozzáad / levesz", listMain: "fő",
    listAdded: "Hozzáadva", listRemoved: "Levéve", listMainFixed: "A fő termosztát marad", listError: "Nem menthető (YAML?)",
    presetTitle: "Beállítás:", until: "{t}-ig", endHome: "hazaérkezésig", endOnce: "egyszeri", ext: "KÜLSŐ",
    presets: { eco: "Eco", away: "Távol", vacation: "Szabadság", sleep: "Alvás", night: "Éjszaka", comfort: "Komfort",
      home: "Otthon", boost: "Gyors felfűtés", activity: "Aktivitás", auto: "Auto", none: "Nincs" },
  },
  en: {
    days: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], target: "SET", now: "now", was: "was", on: "ON", off: "OFF",
    heat: "HEAT", cool: "COOL", unavailable: "Unavailable", saved: "Saved", unchanged: "Unchanged",
    error: "Error – not saved", shadow: "Shadow mode: no switching",
    hintRange: "Ring: adjust · tap: heat/cool · button: on/off · long press: save",
    hint: "Ring: adjust · button: on/off · long press: save",
    menuTitle: "This device follows:", menuDefault: "Default", menuNone: "Don't follow", menuClose: "Close",
    listTitle: "Thermostats on the card", listHint: "tap: select · long press: add / remove", listMain: "main",
    listAdded: "Added", listRemoved: "Removed", listMainFixed: "The main thermostat stays", listError: "Cannot save (YAML?)",
    presetTitle: "Preset:", until: "until {t}", endHome: "until someone is home", endOnce: "once", ext: "EXT",
    presets: { eco: "Eco", away: "Away", vacation: "Vacation", sleep: "Sleep", night: "Night", comfort: "Comfort",
      home: "Home", boost: "Boost", activity: "Activity", auto: "Auto", none: "None" },
  },
  de: {
    days: ["SO", "MO", "DI", "MI", "DO", "FR", "SA"], target: "SOLL", now: "jetzt", was: "vorher", on: "EIN", off: "AUS",
    heat: "HEIZEN", cool: "KÜHLEN", unavailable: "Nicht verfügbar", saved: "Gespeichert", unchanged: "Unverändert",
    error: "Fehler – nicht gespeichert", shadow: "Schattenmodus: schaltet nicht",
    hintRange: "Ring: einstellen · Tippen: Heizen/Kühlen · Taste: Ein/Aus · lange drücken: speichern",
    hint: "Ring: einstellen · Taste: Ein/Aus · lange drücken: speichern",
    menuTitle: "Dieses Gerät folgt:", menuDefault: "Standard", menuNone: "Nicht folgen", menuClose: "Schließen",
    presetTitle: "Profil:", until: "bis {t}", endHome: "bis jemand heimkommt", endOnce: "einmalig", ext: "EXTERN",
    presets: { eco: "Eco", away: "Abwesend", vacation: "Urlaub", sleep: "Schlafen", night: "Nacht", comfort: "Komfort",
      home: "Zuhause", boost: "Boost", activity: "Aktivität", auto: "Auto", none: "Keine" },
  },
};
const AWAY_STATES = ["unknown", "unavailable", "not_home", "away", "none", ""];

class HcDialCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entity) throw new Error("entity is required (climate.*)");
    const reopen = this._mode === "menu" && this._menuKind === "therm"; // saved from the list: keep it open
    this._orig = config;
    this._base = { timeout: 15, step_angle: 18, preset_menu: true, control: "auto", ...config };
    this._cand = null; // null = main thermostat
    this._sig = "";
    this._cfg = this._merge(null);
    this._mode = "view"; // view | set | saved | cancel | menu
    this._pending = null;
    this._ringAngle = 0;
    if (!this.shadowRoot) this._build();
    else this._$("dev").classList.remove("menuopen");
    if (reopen && this._hass) setTimeout(() => this._openThermMenuAgain(), 0);
  }

  static getConfigElement() {
    return document.createElement("hc-dial-card-editor");
  }

  static getStubConfig(hass, entities) {
    const ids = entities || (hass ? Object.keys(hass.states) : []);
    return { entity: ids.find((e) => e.startsWith("climate.")) || "climate.example" };
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  set hass(hass) {
    this._hass = hass;
    this._follow();
    this._render();
    if (!this._reopenChecked) this._reopenAfterSave();
  }
  // saving the list makes the dashboard rebuild the card: the new one opens the list again with the result
  _reopenAfterSave() {
    this._reopenChecked = true;
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem("hc-dial-card:reopen") || "null"); } catch (e) { /* no storage */ }
    if (!r || r.e !== this._base.entity || Date.now() - r.t > 15000) return;
    try { sessionStorage.removeItem("hc-dial-card:reopen"); } catch (e) { /* no storage */ }
    setTimeout(() => {
      if (!this.isConnected || this._mode !== "view") return;
      this._thSel = r.sel;
      this._openThermMenu();
      this._thToast(this._t(r.msg), true);
    }, 300);
  }

  /* ---------- room following ---------- */
  // o: the chosen room candidate ({entity, label, ...}) or null = main thermostat
  _merge(o) {
    const b = this._base;
    o = o ? { ...o } : {};
    // the main entity's entity-specific options do not apply to a room's own thermostat
    if (o.entity && o.entity !== b.entity) {
      for (const k of ["heating", "decision", "step", "window", "humidity"]) if (!(k in o)) o[k] = undefined;
    }
    const c = { ...b, ...o };
    for (const k of ["rooms", "follow", "follow_app_only", "area_labels", "trv", "room_map", "away_states", "follow_choices"]) delete c[k];
    return c;
  }
  // per-device choice (browser localStorage): "none" = do not follow, sensor id = follow it, missing = default
  _devKey() {
    return `hc-dial-card:follow:${this._base.entity}`;
  }
  _devChoice() {
    try { return localStorage.getItem(this._devKey()); } catch (e) { return null; }
  }
  _setDevChoice(v) {
    try { if (v === null) localStorage.removeItem(this._devKey()); else localStorage.setItem(this._devKey(), v); } catch (e) { /* no storage */ }
  }
  // beacons offered in the menu: the configured ones + detected room sensors (Bermuda: area_id + current_mac)
  _followChoices() {
    const b = this._base, h = this._hass;
    const ids = new Set();
    if (typeof b.follow === "string") ids.add(b.follow);
    else if (b.follow) Object.values(b.follow).forEach((v) => ids.add(v));
    [].concat(b.follow_choices || []).forEach((v) => ids.add(v));
    if (h) for (const [id, st] of Object.entries(h.states)) {
      if (id.startsWith("sensor.") && st.attributes && "area_id" in st.attributes && "current_mac" in st.attributes) ids.add(id);
    }
    return [...ids];
  }
  // Companion app: the app's own bridge (Android: externalApp, iOS: externalBus), user agent as fallback
  _isApp() {
    try {
      if (window.externalApp) return true;
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.externalBus) return true;
    } catch (e) { /* not available */ }
    return /Home ?Assistant\//i.test(navigator.userAgent || "");
  }
  _followSensor() {
    const b = this._base;
    if (!this._hass) return null;
    const dev = this._devChoice();
    if (dev === "none") return null;
    if (dev) return dev; // beacon chosen on this device (follow_app_only does not apply)
    if (!b.follow) return null;
    // follow_app_only: follow only in the Companion app (on the phone); browsers show the main thermostat
    if (b.follow_app_only && !this._isApp()) return null;
    if (typeof b.follow === "string") return b.follow;
    const u = this._hass.user;
    return (u && (b.follow[u.name] || b.follow[u.id])) || null;
  }
  // Several thermostats in one room: show the one that is on (for a TRV the main thermostat decides).
  // the thermostat's own demand in %: HC Thermostat (demand), Versatile Thermostat (power_percent, or the
  // older on_percent 0–1), Smart Thermostat (control_output)
  _demandPct(a) {
    const n = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
    if (n(a.demand) !== null) return n(a.demand);
    if (n(a.power_percent) !== null) return n(a.power_percent);
    if (n(a.on_percent) !== null) return n(a.on_percent) * 100;
    if (n(a.control_output) !== null) return n(a.control_output);
    return null;
  }
  // kind of heat: card setting, then the thermostat's own heat_type, then a guess from its modes
  _heatType(st) {
    const t = this._cfg && this._cfg.heat_type;
    if (t && t !== "auto" && HEAT_TYPE[t]) return t;
    const a = (st && st.attributes) || {};
    if (a.heat_type && HEAT_TYPE[a.heat_type]) return a.heat_type;
    const modes = a.hvac_modes || [];
    return modes.includes("cool") ? "air_conditioner" : "gas_boiler";
  }
  _pick(spec) {
    const list = [].concat(spec).map((x) => (typeof x === "string" ? { entity: x } : x));
    const isOn = (c) => {
      const id = c.trv || c.on_by ? (c.on_by || this._base.entity) : c.entity;
      const st = this._hass.states[id];
      return !!st && !["off", "unavailable", "unknown"].includes(st.state);
    };
    return list.find(isOn) || list[0];
  }
  _follow() {
    const sid = this._followSensor();
    this._following = !!sid;
    if (this._mode !== "view") return;
    let cand = null;
    if (sid) {
      const st = this._hass.states[sid];
      const area = st ? st.state : null;
      const away = (this._base.away_states || AWAY_STATES).map(norm);
      if (!area || away.includes(norm(area))) {
        // no room: keep the last one during short dropouts, after away_hold show the main thermostat (away)
        if (!this._lostSince) this._lostSince = Date.now();
        const hold = (this._base.away_hold ?? 60) * 1000;
        if (Date.now() - this._lostSince < hold) cand = this._home;
        else { cand = null; this._area = null; }
      } else {
        this._lostSince = 0;
        const room = this._resolveRoom(area, st.attributes.area_id);
        this._area = room.name;
        const rooms = this._base.rooms || {};
        const key = Object.keys(rooms).find((k) => room.keys.has(norm(k)));
        cand = key !== undefined ? this._pick(rooms[key]) : null;
      }
    } else {
      this._area = null;
    }
    this._home = cand; // the room-based (default) choice
    if (this._override !== undefined && this._override !== false) cand = this._override === "base" ? null : this._override; // chosen by tap
    const sig = cand ? JSON.stringify(cand) : "";
    if (sig !== this._sig) {
      this._sig = sig;
      this._cand = cand;
      this._cfg = this._merge(cand);
    }
  }
  // followed value → room: room_map first, then match HA area names and ids
  _resolveRoom(raw, attrAreaId) {
    const map = this._base.room_map || {};
    const mk = Object.keys(map).find((k) => norm(k) === norm(raw));
    const val = mk !== undefined ? map[mk] : raw;
    const keys = new Set([norm(val)]);
    if (attrAreaId) keys.add(norm(attrAreaId));
    let name = String(val);
    const areas = (this._hass && this._hass.areas) || {};
    for (const a of Object.values(areas)) {
      if (keys.has(norm(a.area_id)) || keys.has(norm(a.name))) {
        keys.add(norm(a.area_id));
        keys.add(norm(a.name));
        name = a.name;
      }
    }
    return { name, keys };
  }
  // all thermostats of the card: main + those in rooms (unique entities)
  _all() {
    const out = [null];
    const seen = new Set([this._base.entity]);
    for (const v of Object.values(this._base.rooms || {})) {
      for (const x of [].concat(v)) {
        const c = typeof x === "string" ? { entity: x } : x;
        if (c && c.entity && !seen.has(c.entity)) { seen.add(c.entity); out.push(c); }
      }
    }
    return out;
  }
  // tap_action: auto (several thermostats → cycle, one → more-info) | more-info | cycle | none
  _tap() {
    const ta = this._base.tap_action || "auto";
    const many = this._all().length > 1;
    if (ta === "none") return;
    if (ta === "cycle" || (ta === "auto" && many)) {
      // double tap: a single tap does nothing, so a stray touch never switches the thermostat
      const now = performance.now();
      if (now - (this._lastTap || 0) < 400) { this._lastTap = 0; this._cycle(); } else this._lastTap = now;
      return;
    }
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._cfg.entity }, bubbles: true, composed: true }));
  }
  _cycle() {
    const list = this._all();
    if (list.length < 2) return;
    const cur = this._cfg.entity;
    const i = list.findIndex((c) => (c ? c.entity : this._base.entity) === cur);
    const next = list[(i + 1) % list.length];
    const homeEnt = this._home ? this._home.entity : this._base.entity;
    this._override = (next ? next.entity : this._base.entity) === homeEnt ? false : (next || "base");
    this._vibrate(12);
    this._armBack();
    this._sig = "\u0000"; // force recompute
    this._follow();
    this._render();
  }
  _armBack() {
    clearTimeout(this._backT);
    if (!this.isConnected || this._override === undefined || this._override === false) return;
    this._backT = setTimeout(() => {
      if (this._mode !== "view") return; // not during SET; restarted when SET ends
      this._override = false;
      this._sig = "\u0000";
      this._follow();
      this._render();
    }, (this._base.switch_back ?? 10) * 1000);
  }

  _short(name) {
    const m = this._base.area_labels || {};
    return name ? (m[name] ?? name) : "";
  }
  // the thermostat's area: entity area, else its device's area
  _entityArea(eid) {
    const h = this._hass;
    const e = h && h.entities ? h.entities[eid] : null;
    if (!e) return "";
    const aid = e.area_id || (e.device_id && h.devices && h.devices[e.device_id] ? h.devices[e.device_id].area_id : null);
    return aid && h.areas && h.areas[aid] ? h.areas[aid].name : "";
  }

  connectedCallback() {
    // a tap outside the ring closes an open menu at once and brings back the room's (main) thermostat
    if (!this._outside) {
      this._outside = (e) => {
        if (!this.shadowRoot) return;
        const ring = this._$("ring"), disp = this._$("disp"), menu = this._$("menu");
        if (e.composedPath().some((el) => el === ring || el === disp || el === menu)) return;
        if (this._mode === "menu") this._closeMenu();
        if (this._mode === "view" && this._override !== undefined && this._override !== false) {
          clearTimeout(this._backT);
          this._override = false;
          this._sig = "\u0000";
          this._follow();
          this._render();
        }
      };
    }
    document.addEventListener("pointerdown", this._outside, true);
    this._clock = setInterval(() => this._renderClock(), 15000);
    this._renderClock();
  }

  disconnectedCallback() {
    if (this._outside) document.removeEventListener("pointerdown", this._outside, true);
    clearInterval(this._clock);
    if (this._mode === "menu") { this._$("dev").classList.remove("menuopen"); this._mode = "view"; }
    if (this._mode === "set") this._leave("view");
    this._clearTimers();
  }

  /* ---------- helpers ---------- */
  _st(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }
  _num(id) {
    const s = this._st(id);
    const v = s ? parseFloat(s.state) : NaN;
    return Number.isFinite(v) ? v : null;
  }
  _lang() {
    const l = (this._hass?.locale?.language || this._hass?.language || "en").slice(0, 2).toLowerCase();
    return STR[l] ? l : "en";
  }
  _t(k) {
    return STR[this._lang()][k] ?? STR.en[k];
  }
  // number format from the HA locale settings
  _numLocale() {
    const nf = this._hass?.locale?.number_format;
    const lang = this._hass?.locale?.language || "en";
    return { language: lang, system: undefined, comma_decimal: "en-US", decimal_comma: "de-DE", space_comma: "fr-FR", none: lang }[nf] ?? lang;
  }
  _hu() {
    return (this._hass?.locale?.language || this._hass?.language || "hu").startsWith("hu");
  }
  _fmt(v, d = 1) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "--";
    try {
      return new Intl.NumberFormat(this._numLocale(), { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(v);
    } catch (e) {
      return v.toFixed(d);
    }
  }
  _vibrate(ms) {
    try {
      navigator.vibrate && navigator.vibrate(ms);
    } catch (e) {
      /* not supported */
    }
  }

  /* ---------- DOM ---------- */
  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { background: transparent; border: none; box-shadow: none; border-radius: 0;
                  padding: 3%; box-sizing: border-box; overflow: visible; container-type: inline-size; --cq: 1cqw; }
        .disp:focus-visible { outline: 3px solid #ff9a3c; outline-offset: 2px; }
        .dev { position: relative; width: 100%; aspect-ratio: 1; margin: 0 auto; max-width: 520px;
               user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
        /* knurled outer ring */
        .ring { position:absolute; inset:0; border-radius:50%; touch-action:none; cursor:grab; overflow:hidden;
                box-shadow: 0 0 0 1px #000, 0 10px 30px rgba(0,0,0,.8);
                transition: box-shadow .3s; }
        /* fixed reflection above the rotating knurl */
        .ring::after { content:""; position:absolute; inset:0; border-radius:50%; pointer-events:none;
                background: conic-gradient(from 200deg, rgba(255,255,255,.30), rgba(0,0,0,.40) 25%, rgba(255,255,255,.14) 50%, rgba(0,0,0,.50) 75%, rgba(255,255,255,.30));
                mix-blend-mode: overlay; box-shadow: inset 0 0 12px rgba(0,0,0,.9); }
        /* rotating part: the knurl itself */
        .knurl { position:absolute; inset:0; border-radius:50%; will-change: transform; transition: transform .18s ease-out;
                 background:
                   repeating-conic-gradient(from 0deg, rgba(255,255,255,0) 0deg 1.5deg, rgba(255,255,255,.22) 2.5deg, rgba(255,255,255,0) 3.5deg 5deg),
                   repeating-conic-gradient(from 0deg, #0c0d0e 0deg 1.4deg, #3a3e43 2.2deg, #a3aab1 3deg, #2a2d31 4deg, #0c0d0e 5deg); }
        .knurl.drag { transition: none; }
        .mark { position:absolute; left:50%; top:1.6%; width:2.2%; height:2.2%; margin-left:-1.1%; border-radius:50%;
                background:#ff9a3c; box-shadow: 0 0 6px 2px rgba(255,140,40,.8); opacity:0; transition: opacity .3s; }
        .dev.set .mark { opacity:1; }
        .dev.set .ring { cursor:grabbing; box-shadow: 0 0 0 1px #000, 0 0 26px rgba(255,140,40,.55), 0 10px 30px rgba(0,0,0,.8), inset 0 0 12px rgba(0,0,0,.9); }
        /* glossy black bezel */
        .bezel { position:absolute; inset:6%; border-radius:50%;
                 background: radial-gradient(circle at 35% 25%, #4a4f55 0%, #15171a 35%, #000 60%, #24272b 100%);
                 box-shadow: 0 0 0 2px #000, inset 0 2px 6px rgba(255,255,255,.25), inset 0 -4px 10px rgba(0,0,0,.9); }
        .disp { position:absolute; inset:11%; border-radius:50%; background: radial-gradient(circle at 50% 40%, #0b0c0e, #000 70%);
                box-shadow: inset 0 0 18px rgba(0,0,0,1), 0 0 0 2px #111; overflow:hidden; color:#fff;
                font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; touch-action: manipulation; cursor:pointer; }
        .disp::before { content:""; position:absolute; inset:0; border-radius:50%; pointer-events:none;
                background: linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,0) 40%); }
        .abs { position:absolute; transform: translate(-50%,-50%); display:flex; align-items:center; gap:calc(.6 * var(--cq)); white-space:nowrap; }
        ha-icon { --mdc-icon-size: calc(5.6 * var(--cq)); display:flex; }
        .wx { left:50%; top:14%; font-size:calc(4 * var(--cq)); color:#e8e8e8; gap:calc(1.6 * var(--cq)); }
        .wx ha-icon { color:#f2f2f2; }
        .wx .drop { color:#4fb3ff; --mdc-icon-size: calc(3.8 * var(--cq)); }
        .eco { left:20.5%; top:49%; transform: translate(-100%, -50%); color:#bbb; }
        .ctl { left:20%; top:27%; font-size:calc(3.2 * var(--cq)); font-weight:600; letter-spacing:.08em; color:#8fb3c9; }
        .ctl:empty { display:none; }
        .mode { left:41%; top:27%; }
        .mode .dot { width:calc(7.6 * var(--cq)); height:calc(7.6 * var(--cq)); border-radius:50%; display:flex; align-items:center; justify-content:center; background:#333; }
        .mode .dot ha-icon { --mdc-icon-size: calc(5 * var(--cq)); color:#fff; }
        .burn { left:62%; top:27%; color:#444; gap:calc(1 * var(--cq)); }
        .burn.on > ha-icon { color:var(--act, #ff8a1f); animation: flick 1.2s infinite alternate; }
        .bars { display:flex; align-items:flex-end; gap:calc(.5 * var(--cq)); }
        .bars i { display:block; width:calc(3.4 * var(--cq)); background:#2a2a2a; border-radius:calc(.3 * var(--cq)); }
        .bars i:nth-child(1){height:calc(1.4 * var(--cq))} .bars i:nth-child(2){height:calc(2.2 * var(--cq))} .bars i:nth-child(3){height:calc(3 * var(--cq))}
        .bars i.on { background:var(--act, #ff8a1f); }
        .burn.req .bars i.on { background:#c9a227; }
        @keyframes flick { from { opacity:.75; transform: scale(.95);} to { opacity:1; transform: scale(1.05);} }
        .win { left:86%; top:42%; color:#333; }
        .win.on { color:#4fb3ff; animation: blink 1s infinite; }
        .wifi { left:86%; top:54%; color:#2f8cff; }
        .wifi.off { color:#e53935; }
        @keyframes blink { 50% { opacity:.25; } }
        .lbl { left:24%; top:38.5%; transform: translate(-100%, -50%); font-size:calc(2.6 * var(--cq)); letter-spacing:.1em; color:#cfcfcf; }
        .big { left:50%; top:47%; font-weight:300; font-size:calc(20 * var(--cq)); line-height:1; letter-spacing:-.02em; }
        .big sup { font-size:calc(5 * var(--cq)); font-weight:400; vertical-align: top; position:relative; top:calc(1.8 * var(--cq)); margin-left:calc(.4 * var(--cq)); }
        .line { left:50%; top:61%; width:52%; height:calc(.55 * var(--cq)); border-radius:calc(1 * var(--cq)); background:#9bd22c; transition: background .4s; }
        .sub { left:50%; top:70%; font-size:calc(6 * var(--cq)); font-weight:300; gap:calc(1.2 * var(--cq)); }
        .sub small { font-size:calc(2.4 * var(--cq)); letter-spacing:.1em; color:#cfcfcf; align-self:flex-start; margin-top:calc(.6 * var(--cq)); }
        .sub .u { font-size:calc(2.8 * var(--cq)); align-self:flex-start; margin-top:calc(.4 * var(--cq)); }
        .lock { left:19%; top:72%; color:#3d8bfd; }
        .shadowm { left:83%; top:63%; color:#3bb54a; }
        .tlist { left:81%; top:72%; color:#8a9099; cursor:pointer; padding:calc(1 * var(--cq)); }
        .dev.set .tlist { display:none !important; }
        .dev.menuopen .menu.tl { justify-content:flex-start; padding:17% 15% 14%; gap:calc(.9 * var(--cq)); }
        .menu.tl .mt small { display:block; font-size:calc(2.3 * var(--cq)); color:#888; margin-top:calc(.4 * var(--cq)); text-align:center; }
        .menu.tl .mi { font-size:calc(3 * var(--cq)); padding:calc(.9 * var(--cq)) calc(1.6 * var(--cq)); text-align:left; position:relative; overflow:hidden; }
        .menu.tl .mi small { display:block; font-size:calc(2.2 * var(--cq)); color:#9aa; }
        .menu.tl .mi.on { border-color:#3bb54a; }
        .menu.tl .mi.on::after { content:"✓"; position:absolute; right:calc(1.6 * var(--cq)); top:50%; transform:translateY(-50%); color:#3bb54a; }
        .menu.tl .mi.sel { border-color:#ff9a3c; color:#ffb067; }
        .menu.tl .mi.hold::before { content:""; position:absolute; inset:0; background:rgba(255,154,60,.35); transform-origin:left;
                                    animation: fillx .65s linear forwards; }
        @keyframes fillx { from { transform:scaleX(0); } to { transform:scaleX(1); } }
        .pwr { left:81%; top:70%; display:none; flex-direction:column; gap:calc(.2 * var(--cq)); font-size:calc(2.2 * var(--cq)); letter-spacing:.1em; color:#888;
               padding:calc(1.2 * var(--cq)); border-radius:50%; cursor:pointer; }
        .pwr ha-icon { --mdc-icon-size: calc(8 * var(--cq)); }
        .pwr.on { color:#7bc043; }
        .dev.set .pwr { display:flex; }
        .dev.set .shadowm { display:none !important; }
        .dev.poff .big { color:#777 !important; }
        .dev.poff .line { background:#555 !important; animation:none; }
        .clock { left:50%; top:84%; font-size:calc(5 * var(--cq)); font-weight:500; letter-spacing:.04em; gap:calc(2.2 * var(--cq)); }
        .eco.tap { cursor:pointer; }
        .hint { left:50%; top:83%; font-size:calc(2.9 * var(--cq)); color:#bbb; display:none; text-align:center; white-space:normal; width:56%; }
        /* SET mode */
        .dev.set .lbl, .dev.set .sub, .dev.set .clock { display:none; }
        .dev.set .hint { display:flex; justify-content:center; }
        .setl { left:50%; top:25%; display:none; font-size:calc(4.2 * var(--cq)); letter-spacing:.3em; color:#ff9a3c; font-weight:600; }
        .dev.set .setl { display:flex; }
        .setn { left:50%; top:15.5%; display:none; max-width:58%; font-size:calc(3.4 * var(--cq)); color:#e6e6e6; letter-spacing:.03em; }
        .setn span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dev.set .setn { display:flex; }
        .setl small { font-size:calc(2.8 * var(--cq)); letter-spacing:.15em; margin-left:calc(1.4 * var(--cq)); }
        .dev.cool .setl, .dev.cool.set .big { color:#6fb6ff; }
        .dev.cool.set .line { background:#2f8cff; }
        .dev.cool.set .ring { box-shadow: 0 0 0 1px #000, 0 0 26px rgba(47,140,255,.6), 0 10px 30px rgba(0,0,0,.8); }
        .dev.cool .mark { background:#4fb3ff; box-shadow: 0 0 6px 2px rgba(47,140,255,.8); }
        .dev.cool .lock { color:#6fb6ff !important; }
        .dev.set .wx, .dev.set .eco, .dev.set .ctl, .dev.set .mode, .dev.set .burn { display:none; }
        .dev.set .big { color:#ffb067; }
        .dev.set .line { background:#ff8a1f; animation: pulse 1.2s infinite; }
        @keyframes pulse { 50% { opacity:.35; } }
        .cur { left:50%; top:70%; display:none; font-size:calc(3.3 * var(--cq)); color:#aaa; }
        .dev.set .cur { display:flex; }
        .toast { left:50%; top:50%; display:none; flex-direction:column; gap:calc(1 * var(--cq)); font-size:calc(5 * var(--cq)); background:rgba(0,0,0,.85);
                 width:100%; height:100%; justify-content:center; border-radius:50%; }
        .toast ha-icon { --mdc-icon-size: calc(12 * var(--cq)); }
        .dev.saved .toast, .dev.cancel .toast { display:flex; }
        .dev.saved .toast ha-icon { color:#7bc043; }
        .dev.cancel .toast ha-icon { color:#999; }
        .press { position:absolute; inset:0; border-radius:50%; pointer-events:none; opacity:0;
                 background: conic-gradient(rgba(255,154,60,.35) var(--p,0%), transparent 0); }
        .dev.pressing .press { opacity:1; }
        .menu { position:absolute; inset:0; border-radius:50%; background:rgba(0,0,0,.92); display:none; flex-direction:column;
                align-items:center; justify-content:center; gap:calc(1.2 * var(--cq)); padding:12% 14%; overflow:auto; }
        .dev.menuopen .menu { display:flex; }
        .menu .mt { font-size:calc(3 * var(--cq)); color:#bbb; letter-spacing:.06em; margin-bottom:calc(.6 * var(--cq)); }
        .menu .mi { font: inherit; font-size:calc(3.4 * var(--cq)); color:#eee; background:#1e2024; border:1px solid #333; border-radius:calc(2.4 * var(--cq));
                    padding:calc(1.2 * var(--cq)) calc(2.4 * var(--cq)); width:100%; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .menu .mi.sel { border-color:#ff9a3c; color:#ffb067; }
        .menu .mi.close { background:transparent; border-color:transparent; color:#999; font-size:calc(3 * var(--cq)); }
        .menu .mi { flex-shrink:0; }
        .dev.menuopen .menu.pm { display:grid; grid-template-columns:1fr 1fr; align-content:center; gap:calc(1 * var(--cq)); padding:15% 13%; }
        .menu.pm .mt, .menu.pm .mi.close { grid-column:1 / -1; justify-self:center; }
        .menu.pm .mi { font-size:calc(3 * var(--cq)); padding:calc(.9 * var(--cq)) calc(1.2 * var(--cq)); line-height:1.15; }
        .menu.pm .mi small { display:block; font-size:calc(2.3 * var(--cq)); color:#9aa; margin-top:calc(.2 * var(--cq)); }
        .menu.pm .mi.sel small { color:#d9a36a; }
        .unav { left:50%; top:50%; font-size:calc(4 * var(--cq)); color:#e53935; display:none; }
        .dev.unavail .unav { display:flex; }
      </style>
      <ha-card>
        <div class="dev" id="dev">
          <div class="ring" id="ring"><div class="knurl" id="knurl"><div class="mark"></div></div></div>
          <div class="bezel"></div>
          <div class="disp" id="disp" tabindex="0" role="group">
            <div class="abs wx" id="wx"><ha-icon id="wxi" icon="mdi:weather-partly-cloudy"></ha-icon><span id="out"></span><ha-icon class="drop" icon="mdi:water"></ha-icon><span id="hum"></span></div>
            <div class="abs ctl" id="ctl"></div>
            <div class="abs eco" id="eco"><ha-icon id="ecoi" icon="mdi:leaf"></ha-icon></div>
            <div class="abs mode"><div class="dot" id="mdot"><ha-icon id="mico" icon="mdi:fire"></ha-icon></div></div>
            <div class="abs burn" id="burn"><ha-icon icon="mdi:fire"></ha-icon><div class="bars"><i></i><i></i><i></i></div></div>
            <div class="abs win" id="win"><ha-icon icon="mdi:window-open-variant"></ha-icon></div>
            <div class="abs wifi" id="wifi"><ha-icon id="wifii" icon="mdi:wifi"></ha-icon></div>
            <div class="abs setn" id="setn"><span id="setnt"></span></div>
            <div class="abs setl" id="setl">SET<small id="setf"></small></div>
            <div class="abs lbl" id="lbl"><span id="lblt"></span></div>
            <div class="abs big" id="big">--</div>
            <div class="abs line" id="line"></div>
            <div class="abs sub" id="sub"><small id="subl">CÉL</small><span id="tgt">--</span><span class="u" id="unit">°C</span></div>
            <div class="abs cur" id="cur"></div>
            <div class="abs lock" id="lock"><ha-icon id="locki" icon="mdi:lock"></ha-icon></div>
            <div class="abs shadowm" id="shadowm"><ha-icon icon="mdi:eye-outline"></ha-icon></div>
            <div class="abs tlist" id="tlist"><ha-icon icon="mdi:thermostat"></ha-icon></div>
            <div class="abs pwr" id="pwr"><ha-icon icon="mdi:power"></ha-icon><span id="pwrt"></span></div>
            <div class="abs clock" id="clock"><span id="time"></span><span id="day"></span></div>
            <div class="abs hint" id="hint"></div>
            <div class="abs unav" id="unav"></div>
            <div class="abs toast" id="toast" aria-live="polite"><ha-icon id="toasti" icon="mdi:check-circle"></ha-icon><span id="toastt"></span></div>
            <div class="press" id="press"></div>
            <div class="menu" id="menu"></div>
          </div>
        </div>
      </ha-card>`;
    this._$ = (id) => root.getElementById(id);
    this._bindPress();
    this._bindThermMenu();
    this._bindRing();
    this._bindKeys();
    // old browsers (no container queries): compute --cq from the card's width
    try {
      if (!(window.CSS && CSS.supports && CSS.supports("width", "1cqw"))) {
        const card = root.querySelector("ha-card");
        const fit = () => { const w = card.clientWidth; if (w) card.style.setProperty("--cq", `${w / 100}px`); };
        if (window.ResizeObserver) new ResizeObserver(fit).observe(card);
        setTimeout(fit, 0);
      }
    } catch (e) { /* keep cqw */ }
    this._$("menu").addEventListener("click", (e) => {
      e.stopPropagation();
      const bt = e.target.closest("button");
      if (!bt) return;
      if (this._menuKind === "therm" && !bt.dataset.close) {
        if (this._thHeld) { this._thHeld = false; return; }
        this._thSel = bt.dataset.e;
        this._$("menu").querySelectorAll("button[data-e]").forEach((b) => b.classList.toggle("sel", b.dataset.e === this._thSel));
        return;
      }
      if (!bt.dataset.close) {
        if (this._menuKind === "preset") this._setPreset(bt.dataset.v);
        else this._setDevChoice(bt.dataset.v === "" ? null : bt.dataset.v);
      }
      this._closeMenu();
    });
  }

  /* ---------- long press on the display ---------- */
  _bindPress() {
    const disp = this._$("disp");
    const dev = this._$("dev");
    const LONG = 650;
    let t0 = 0, x0 = 0, y0 = 0, raf = 0, timer = 0, armed = false;
    const stop = () => {
      armed = false;
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      dev.classList.remove("pressing");
      this._$("press").style.setProperty("--p", "0%");
    };
    const anim = () => {
      const p = Math.min(100, ((performance.now() - t0) / LONG) * 100);
      this._$("press").style.setProperty("--p", p + "%");
      if (p < 100) raf = requestAnimationFrame(anim);
    };
    disp.addEventListener("contextmenu", (e) => e.preventDefault());
    disp.addEventListener("pointerdown", (e) => {
      if (this._mode === "saved" || this._mode === "cancel" || this._mode === "menu") return;
      if (this._mode === "set" && e.composedPath().some((el) => el.id === "pwr")) { this._togglePower(); return; }
      clearTimeout(this._backT);
      this._onPreset = e.composedPath().some((el) => el.id === "eco");
      this._onList = e.composedPath().some((el) => el.id === "tlist");
      t0 = performance.now(); x0 = e.clientX; y0 = e.clientY; armed = true;
      dev.classList.add("pressing");
      raf = requestAnimationFrame(anim);
      timer = setTimeout(() => { stop(); this._onLong(); }, LONG);
    });
    disp.addEventListener("pointermove", (e) => {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > 12) stop();
    });
    disp.addEventListener("pointerup", () => {
      const tap = armed && performance.now() - t0 < 350;
      stop();
      if (tap && this._mode === "set" && this._vals && Object.keys(this._vals).length > 1) this._toggleField();
      else if (tap && this._mode === "view" && this._onPreset && this._presetMenuOk()) this._openPresetMenu();
      else if (tap && this._mode === "view" && this._onList && this._manageOk()) this._openThermMenu();
      else if (tap && this._mode === "view") this._tap();
      else if (this._mode === "view") this._armBack();
    });
    ["pointercancel", "pointerleave"].forEach((ev) => disp.addEventListener(ev, stop));
    disp.addEventListener("wheel", (e) => {
      if (this._mode !== "set") return;
      e.preventDefault();
      this._step(e.deltaY < 0 ? 1 : -1, e.deltaY < 0 ? this._cfg.step_angle : -this._cfg.step_angle);
    }, { passive: false });
  }

  _onLong() {
    const st = this._st(this._cfg.entity);
    if (!st || st.state === "unavailable") return;
    this._vibrate(40);
    if (this._mode === "view") {
      const a = st.attributes;
      if (!this._canTemp(st) && !this._canPower(st)) return; // nothing to set
      if (!this._canTemp(st)) {
        this._vals = {};
        this._field = null;
      } else if (this._isRange(a)) {
        const lo = parseFloat(a.target_temp_low), hi = parseFloat(a.target_temp_high);
        this._vals = { target_temp_low: Number.isFinite(lo) ? lo : 20, target_temp_high: Number.isFinite(hi) ? hi : 24 };
        const cur = parseFloat(a.current_temperature);
        this._field = a.hvac_action === "cooling" || (Number.isFinite(cur) && Number.isFinite(hi) && cur > hi) ? "target_temp_high" : "target_temp_low";
      } else {
        const t = parseFloat(a.temperature);
        this._vals = { temperature: Number.isFinite(t) ? t : 20 };
        this._field = "temperature";
      }
      this._pending = this._field ? this._vals[this._field] : null;
      this._pOn = st.state !== "off";
      this._mode = "set";
      clearTimeout(this._backT);
      this._arm();
      this._render();
    } else if (this._mode === "set") {
      this._save();
    }
  }

  /* ---------- ring rotation ---------- */
  _bindRing() {
    const ring = this._$("ring");
    let last = null, acc = 0;
    const ang = (e) => {
      const r = ring.getBoundingClientRect();
      return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    };
    let menuT = 0;
    ring.addEventListener("pointerdown", (e) => {
      if (this._mode === "view") {
        clearTimeout(menuT);
        menuT = setTimeout(() => this._openMenu(), 800);
        const cancel = () => { clearTimeout(menuT); ring.removeEventListener("pointerup", cancel); ring.removeEventListener("pointerleave", cancel); };
        ring.addEventListener("pointerup", cancel);
        ring.addEventListener("pointerleave", cancel);
        return;
      }
      if (this._mode !== "set") return;
      e.preventDefault();
      ring.setPointerCapture(e.pointerId);
      this._$("knurl").classList.add("drag");
      last = ang(e); acc = 0;
    });
    ring.addEventListener("pointermove", (e) => {
      if (last === null || this._mode !== "set") return;
      const a = ang(e);
      let d = a - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = a;
      acc += d;
      this._ringAngle += d;
      this._$("knurl").style.transform = `rotate(${this._ringAngle}deg)`;
      const sa = this._cfg.step_angle;
      while (acc >= sa) { acc -= sa; this._step(1); }
      while (acc <= -sa) { acc += sa; this._step(-1); }
      this._arm();
    });
    const end = () => { last = null; this._$("knurl").classList.remove("drag"); };
    ring.addEventListener("pointerup", end);
    ring.addEventListener("pointercancel", end);
  }

  _step(dir, rot) {
    const st = this._st(this._cfg.entity);
    if (!st || this._pending === null || !this._field) return;
    const a = st.attributes;
    const step = this._stepSize(a);
    const fin = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
    let min = fin(a.min_temp, this._unit() === "°F" ? 45 : 7);
    let max = fin(a.max_temp, this._unit() === "°F" ? 95 : 35);
    if (this._field === "target_temp_low") max = Math.min(max, this._vals.target_temp_high - step);
    if (this._field === "target_temp_high") min = Math.max(min, this._vals.target_temp_low + step);
    const nv = Math.round(((this._pending + dir * step) / step) + 1e-9) * step;
    if (nv < min - 1e-9 || nv > max + 1e-9) { this._vibrate([10, 30, 10]); return; }
    this._pending = +nv.toFixed(2);
    this._vals[this._field] = this._pending;
    this._pOn = true; // changing the target means switching on
    if (rot) {
      this._ringAngle += rot;
      this._$("knurl").style.transform = `rotate(${this._ringAngle}deg)`;
    }
    this._vibrate(8);
    this._arm();
    this._render();
  }

  _isRange(a) {
    return (a.temperature === null || a.temperature === undefined) &&
      a.target_temp_low !== undefined && a.target_temp_low !== null;
  }
  _stepSize(a) {
    return parseFloat(this._cfg.step) || parseFloat(a.target_temp_step) || (this._unit() === "°F" ? 1 : 0.5);
  }
  _unit() {
    return (this._hass && this._hass.config && this._hass.config.unit_system && this._hass.config.unit_system.temperature) || "°C";
  }
  _sf(st) {
    return Number(st && st.attributes.supported_features) || 0;
  }
  _canTemp(st) {
    return (this._sf(st) & (F_TEMP | F_RANGE)) !== 0;
  }
  _canPower(st) {
    return (this._sf(st) & (F_OFF | F_ON)) !== 0 || (st.attributes.hvac_modes || []).includes("off");
  }
  // keyboard: Enter = SET / save, Esc = cancel, arrows = step (in view ←/→ = next thermostat),
  // Space = heating/cooling target, P = on/off, M = device menu
  _bindKeys() {
    const disp = this._$("disp");
    disp.addEventListener("keydown", (e) => {
      const k = e.key;
      if (this._mode === "menu") { if (k === "Escape") { e.preventDefault(); this._closeMenu(); } return; }
      if (this._mode === "view") {
        if (k === "Enter") { e.preventDefault(); this._onLong(); }
        else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); if (this._all().length > 1) this._cycle(); else this._tap(); }
        else if ((k === "t" || k === "T") && this._manageOk()) { e.preventDefault(); this._openThermMenu(); }
        else if (k === "m" || k === "M") { e.preventDefault(); this._openMenu(); }
        else if ((k === "s" || k === "S") && this._presetMenuOk()) { e.preventDefault(); this._openPresetMenu(); }
        return;
      }
      if (this._mode !== "set") return;
      if (k === "Enter") { e.preventDefault(); this._save(); }
      else if (k === "Escape") { e.preventDefault(); this._leave("cancel"); }
      else if (k === "ArrowUp" || k === "ArrowRight") { e.preventDefault(); this._step(1, this._cfg.step_angle); }
      else if (k === "ArrowDown" || k === "ArrowLeft") { e.preventDefault(); this._step(-1, -this._cfg.step_angle); }
      else if (k === " ") { e.preventDefault(); if (this._vals && Object.keys(this._vals).length > 1) this._toggleField(); }
      else if (k === "p" || k === "P") { e.preventDefault(); this._togglePower(); }
    });
  }
  _openMenu() {
    if (this._mode !== "view") return;
    const choices = this._followChoices();
    const cur = this._devChoice();
    const name = (id) => this._hass.states[id]?.attributes?.friendly_name || id;
    const items = [[null, this._t("menuDefault")], ["none", this._t("menuNone")], ...choices.map((id) => [id, name(id)])];
    const m = this._$("menu");
    m.innerHTML = `<div class="mt">${this._t("menuTitle")}</div>` +
      items.map(([v, n]) => `<button class="mi${(v ?? null) === (cur ?? null) ? " sel" : ""}" data-v="${v ?? ""}">${n.replace(/[<>&]/g, "")}</button>`).join("") +
      `<button class="mi close" data-close="1">${this._t("menuClose")}</button>`;
    m.classList.remove("pm", "tl");
    this._mode = "menu";
    this._menuKind = "device";
    this._vibrate(30);
    this._$("dev").classList.add("menuopen");
  }
  // preset menu: a tap on the preset icon; each line tells how long the preset lasts (HC Thermostat)
  _presetMenuOk() {
    const st = this._st(this._cfg.entity);
    return this._cfg.preset_menu !== false && !!st && (this._sf(st) & F_PRESET) !== 0 &&
      Array.isArray(st.attributes.preset_modes) && st.attributes.preset_modes.length > 1;
  }
  _presetEnd(v) {
    if (v === undefined || v === null) return "";
    if (v === "home") return this._t("endHome");
    if (v === "once") return this._t("endOnce");
    let at = null;
    const dur = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(v);
    if (dur) at = new Date(Date.now() + ((+dur[1] || 0) * 60 + (+dur[2] || 0)) * 60000);
    else if (!isNaN(Date.parse(v))) at = new Date(v);
    if (!at) return "";
    const hm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    return this._t("until").replace("{t}", days > 0 ? `${this._t("days")[at.getDay()]} ${hm}` : hm);
  }
  _openPresetMenu() {
    if (this._mode !== "view") return;
    const st = this._st(this._cfg.entity);
    const a = st.attributes, ends = a.preset_end_preview || {};
    const name = (p) => this._t("presets")[p] || p;
    const m = this._$("menu");
    m.innerHTML = `<div class="mt">${this._t("presetTitle")}</div>` +
      a.preset_modes.map((p) => {
        const end = p === a.preset_mode ? "" : this._presetEnd(ends[p]);
        const clean = (s) => String(s).replace(/[<>&]/g, "");
        return `<button class="mi${p === a.preset_mode ? " sel" : ""}" data-v="${p}">${clean(name(p))}${end ? `<small>${clean(end)}</small>` : ""}</button>`;
      }).join("") +
      `<button class="mi close" data-close="1">${this._t("menuClose")}</button>`;
    m.classList.remove("tl");
    m.classList.add("pm");
    this._mode = "menu";
    this._menuKind = "preset";
    this._vibrate(30);
    this._$("dev").classList.add("menuopen");
  }
  async _setPreset(preset) {
    try {
      await this._hass.callService("climate", "set_preset_mode", { entity_id: this._cfg.entity, preset_mode: preset });
    } catch (err) {
      clearTimeout(this._toastT);
      this._mode = "cancel";
      this._$("toastt").textContent = this._t("error");
      this._toastT = setTimeout(() => { this._mode = "view"; this._render(); }, 2000);
      this._render(true);
    }
  }
  // what regulates – HC Thermostat tells it (control_type); other integrations are recognised by their
  // platform (entity registry) and attributes. HIST = on/off with hysteresis.
  _controlLabel(st) {
    const c = this._cfg.control;
    if (c === false || c === "false" || c === "none") return "";
    if (typeof c === "string" && c !== "auto" && c !== "") return c;
    const a = st.attributes;
    const platform = this._hass?.entities?.[st.entity_id]?.platform;
    const has = (k) => a[k] !== undefined && a[k] !== null;
    if (a.control_type) {
      return { tpi: "TPI", pid: "PID", external: this._t("ext"), hysteresis: "HIST", onoff: "HIST" }[a.control_type] || String(a.control_type).toUpperCase();
    }
    if (platform === "generic_thermostat") return "HIST";
    if (platform === "smart_thermostat" || has("pid_mode")) return a.pid_mode === "off" ? "HIST" : "PID";
    if (platform === "sat" || (has("heating_curve") && has("pulse_width_modulation_enabled"))) {
      return a.pulse_width_modulation_enabled ? "SAT·PWM" : "SAT·OT";
    }
    if (platform === "better_thermostat" || (has("call_for_heat") && has("heating_power"))) {
      return has("pid_kp") ? "BT·PID" : Object.keys(a).some((k) => k.startsWith("mpc_v2_")) ? "BT·MPC" : "BT";
    }
    if (platform === "versatile_thermostat" || has("is_over_switch") || has("is_over_valve") || has("is_over_climate")) {
      if (a.is_over_climate) {
        const reg = a.vtherm_over_climate?.regulation?.auto_regulation_mode;
        return reg && reg !== "auto_regulation_none" ? "VT·REG" : "VT";
      }
      const spec = a.specific_states || {};
      if (spec.auto_tpi_state === "on") return "AUTO-TPI";
      const fn = (a.vtherm_over_switch || a.vtherm_over_valve || {}).function;
      return fn ? String(fn).toUpperCase() : "TPI";
    }
    if (platform === "opentherm_gw") return "OT";
    if (platform === "ebusd") return "eBUS";
    return "";
  }
  /* ---------- thermostat list: add / remove thermostats of this card ---------- */
  _manageOk() {
    return this._base.manage !== false && !!this._hass?.user?.is_admin;
  }
  _onCard(id) {
    return this._all().some((c) => (c ? c.entity : this._base.entity) === id);
  }
  _isTrv(id) {
    const h = this._hass, st = this._st(id), e = h?.entities?.[id];
    const d = e?.device_id ? h?.devices?.[e.device_id] : null;
    const txt = [d?.model, d?.model_id, d?.name, st?.attributes?.friendly_name].filter(Boolean).join(" ");
    return /\btrv|radiator ?valve|radiator ?thermostat|thermostatic|heizk|termoszt[aá]tfej|\bfej\b/i.test(txt) ||
      ["valve_position", "pi_heating_demand", "valve_opening_degree"].some((k) => st?.attributes?.[k] !== undefined);
  }
  _thermTag(id) {
    const st = this._st(id);
    if (!st) return "";
    if (this._isTrv(id)) return "TRV";
    const platform = this._hass?.entities?.[id]?.platform;
    if (platform === "hc_thermostat") return "HC";
    if ((st.attributes.hvac_modes || []).some((m) => m === "cool" || m === "heat_cool")) return this._hu() ? "KLÍMA" : "AC";
    return "";
  }
  _openThermMenu() {
    if (this._mode !== "view") return;
    const h = this._hass;
    const ids = Object.keys(h.states).filter((id) => id.startsWith("climate.") && h.states[id].state !== "unavailable");
    const clean = (v) => String(v ?? "").replace(/[<>&"]/g, "");
    const name = (id) => h.states[id].attributes.friendly_name || id;
    ids.sort((a, b) => (this._onCard(b) - this._onCard(a)) || name(a).localeCompare(name(b)));
    const m = this._$("menu");
    m.innerHTML = `<div class="mt">${this._t("listTitle")}<small>${this._t("listHint")}</small></div>` +
      ids.map((id) => {
        const info = [id === this._base.entity ? this._t("listMain") : "", this._entityArea(id), this._thermTag(id)].filter(Boolean).join(" · ");
        return `<button class="mi${this._onCard(id) ? " on" : ""}${id === this._thSel ? " sel" : ""}" data-e="${clean(id)}">${clean(name(id))}<small>${clean(info) || "&nbsp;"}</small></button>`;
      }).join("") +
      `<button class="mi close" data-close="1">${this._t("menuClose")}</button>`;
    m.classList.remove("pm");
    m.classList.add("tl");
    this._mode = "menu";
    this._menuKind = "therm";
    this._vibrate(30);
    this._$("dev").classList.add("menuopen");
    this._thIdleArm();
  }
  // the list closes by itself after 10 s without a touch
  _thIdleArm() {
    clearTimeout(this._thIdle);
    this._thIdle = setTimeout(() => { if (this._mode === "menu" && this._menuKind === "therm") this._closeMenu(); }, 10000);
  }
  _bindThermMenu() {
    const m = this._$("menu");
    let timer = 0, btn = null;
    const stop = () => { clearTimeout(timer); if (btn) btn.classList.remove("hold"); btn = null; };
    this._thStop = stop; // closing the list cancels a press in progress
    m.addEventListener("pointerdown", (e) => {
      if (this._menuKind !== "therm") return;
      clearTimeout(this._thT);
      this._thIdleArm();
      const b = e.target.closest("button[data-e]");
      if (!b) return;
      stop();
      btn = b;
      b.classList.add("hold");
      timer = setTimeout(() => {
        const id = b.dataset.e;
        const open = this._mode === "menu" && this._menuKind === "therm" && b.isConnected && this._$("dev").classList.contains("menuopen");
        stop();
        if (!open) return;
        this._thHeld = true; this._thSel = id; this._toggleTherm(id);
      }, 650);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => m.addEventListener(ev, stop));
    window.addEventListener("pointerup", stop); // released outside the list (e.g. it closed meanwhile)
    m.addEventListener("scroll", () => { stop(); if (this._menuKind === "therm") this._thIdleArm(); }, { passive: true });
  }
  async _toggleTherm(id) {
    this._vibrate(40);
    if (id === this._base.entity) { this._thToast(this._t("listMainFixed"), false); return; }
    const adding = !this._onCard(id);
    const trv = this._isTrv(id);
    const key = this._entityArea(id) || this._st(id)?.attributes?.friendly_name || id;
    const mutate = (card) => {
      const rooms = { ...(card.rooms || {}) };
      if (adding) {
        const item = trv ? { entity: id, trv: true } : id;
        const k = Object.keys(rooms).find((x) => norm(x) === norm(key)) ?? key;
        rooms[k] = rooms[k] === undefined ? item : [].concat(rooms[k], item);
      } else {
        for (const k of Object.keys(rooms)) {
          const left = [].concat(rooms[k]).filter((x) => (typeof x === "string" ? x : x && x.entity) !== id);
          if (!left.length) delete rooms[k];
          else rooms[k] = left.length === 1 ? left[0] : left;
        }
      }
      if (Object.keys(rooms).length) card.rooms = rooms; else delete card.rooms;
    };
    try {
      try { sessionStorage.setItem("hc-dial-card:reopen", JSON.stringify({ e: this._base.entity, t: Date.now(), sel: id, msg: adding ? "listAdded" : "listRemoved" })); } catch (e) { /* no storage */ }
      await this._saveCard(mutate);
      mutate(this._base);
      this._sig = "\u0000";
      this._thToast(this._t(adding ? "listAdded" : "listRemoved"), true);
    } catch (err) {
      try { sessionStorage.removeItem("hc-dial-card:reopen"); } catch (e) { /* no storage */ }
      console.warn("hc-dial-card: saving the thermostat list failed", err);
      this._thToast(this._t("listError"), false);
    }
  }
  // find this card in the dashboard's stored configuration and save the change there
  async _saveCard(mutate) {
    const h = this._hass;
    const seg = decodeURIComponent(location.pathname.split("/")[1] || "");
    const urlPath = !seg || seg === "lovelace" ? null : seg;
    const conf = await h.callWS({ type: "lovelace/config", url_path: urlPath });
    const hits = [];
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (o.type === "custom:hc-dial-card" && o.entity === this._base.entity) hits.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(conf);
    const same = JSON.stringify(this._orig);
    const card = hits.find((o) => JSON.stringify(o) === same) || (hits.length === 1 ? hits[0] : null);
    if (!card) throw new Error(`card not found (${hits.length} with ${this._base.entity})`);
    mutate(card);
    await h.callWS({ type: "lovelace/config/save", url_path: urlPath, config: conf });
  }
  _thToast(text, ok) {
    const m = this._$("menu");
    let t = m.querySelector(".mt small");
    if (t) { t.textContent = text; t.style.color = ok ? "#7bc043" : "#e57373"; }
    clearTimeout(this._thT);
    // success: the list closes after 5 s (touching it again keeps it open); error: back to the hint
    this._thT = setTimeout(() => {
      if (this._mode !== "menu" || this._menuKind !== "therm") return;
      if (ok) this._closeMenu(); else this._openThermMenuAgain();
    }, ok ? 5000 : 1600);
  }
  _openThermMenuAgain() {
    if (this._thStop) this._thStop();
    const top = this._$("menu").scrollTop;
    this._mode = "view";
    this._openThermMenu();
    this._$("menu").scrollTop = top;
  }
  _closeMenu() {
    clearTimeout(this._thT);
    clearTimeout(this._thIdle);
    if (this._thStop) this._thStop();
    this._$("menu").classList.remove("tl");
    this._$("dev").classList.remove("menuopen");
    this._mode = "view";
    this._sig = "\u0000";
    this._follow();
    this._render();
  }
  _togglePower() {
    this._pOn = !this._pOn;
    this._vibrate(20);
    this._arm();
    this._render();
  }
  // when switching on: the last seen non-off mode, else heat_cool > heat > auto > the first non-off one
  _onMode(st) {
    const modes = (st.attributes.hvac_modes || []).filter((m) => m !== "off");
    const last = (this._lastModes || {})[this._cfg.entity];
    if (last && modes.includes(last)) return last;
    return ["heat_cool", "heat", "auto"].find((m) => modes.includes(m)) || modes[0];
  }
  _toggleField() {
    this._field = this._field === "target_temp_low" ? "target_temp_high" : "target_temp_low";
    this._pending = this._vals[this._field];
    this._vibrate(15);
    this._arm();
    this._render();
  }

  /* ---------- timers, saving ---------- */
  _clearTimers() {
    clearTimeout(this._idle);
    clearTimeout(this._toastT);
    clearTimeout(this._backT);
  }
  _arm() {
    clearTimeout(this._idle);
    this._idle = setTimeout(() => this._leave("cancel"), this._cfg.timeout * 1000);
  }
  _leave(how) {
    this._clearTimers();
    this._pending = null;
    this._vals = null;
    if (how === "view") { this._mode = "view"; this._render(); this._armBack(); return; }
    this._mode = how;
    this._render();
    this._toastT = setTimeout(() => { this._mode = "view"; this._render(); this._armBack(); }, how === "saved" ? 1400 : 1100);
  }
  async _save() {
    const st = this._st(this._cfg.entity);
    const vals = this._vals;
    if (!st || !vals) { this._leave("cancel"); return; }
    const ent = this._cfg.entity;
    const isOn = st.state !== "off";
    const powerChg = this._pOn !== isOn;
    const tempChg = Object.keys(vals).some((k) => vals[k] !== parseFloat(st.attributes[k]));
    if (!powerChg && (!tempChg || !this._pOn)) { this._leave("cancel"); return; }
    try {
      const sf = this._sf(st);
      if (powerChg && !this._pOn) {
        if (sf & F_OFF) await this._hass.callService("climate", "turn_off", { entity_id: ent });
        else await this._hass.callService("climate", "set_hvac_mode", { entity_id: ent, hvac_mode: "off" });
        this._savedVal = this._t("off");
        this._leave("saved");
        return;
      }
      if (powerChg) {
        if (sf & F_ON) await this._hass.callService("climate", "turn_on", { entity_id: ent });
        else await this._hass.callService("climate", "set_hvac_mode", { entity_id: ent, hvac_mode: this._onMode(st) });
      }
      if (tempChg && this._canTemp(st)) await this._hass.callService("climate", "set_temperature", { entity_id: ent, ...vals });
      const u = this._unit();
      const tTxt = vals.temperature !== undefined ? `${this._fmt(vals.temperature)} ${u}`
        : vals.target_temp_low !== undefined ? `${this._fmt(vals.target_temp_low)}–${this._fmt(vals.target_temp_high)} ${u}` : "";
      this._savedVal = powerChg ? this._t("on") + (tTxt ? ` · ${tTxt}` : "") : tTxt;
      this._leave("saved");
    } catch (err) {
      this._mode = "cancel";
      this._$("toastt").textContent = this._t("error");
      this._toastT = setTimeout(() => { this._mode = "view"; this._pending = null; this._render(); }, 2000);
      this._render(true);
    }
  }

  /* ---------- rendering ---------- */
  _renderClock() {
    if (!this._$) return;
    const d = new Date();
    this._$("time").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    this._$("day").textContent = this._t("days")[d.getDay()];
  }

  _render(keepToast) {
    if (!this._hass || !this._$) return;
    const $ = this._$;
    const hu = this._hu();
    const cfg = this._cfg;
    const st = this._st(cfg.entity);
    const dev = $("dev");
    dev.classList.toggle("set", this._mode === "set");
    dev.classList.toggle("saved", this._mode === "saved");
    dev.classList.toggle("cancel", this._mode === "cancel");
    const unavail = !st || st.state === "unavailable" || st.state === "unknown";
    dev.classList.toggle("unavail", unavail);
    $("unav").textContent = this._t("unavailable");
    $("wifi").classList.toggle("off", unavail);
    $("wifii").setAttribute("icon", unavail ? "mdi:wifi-off" : "mdi:wifi");
    if (!st) return;
    const a = st.attributes;

    // weather + outdoor
    const w = this._st(cfg.weather);
    $("wxi").setAttribute("icon", (w && WEATHER_ICON[w.state]) || "mdi:thermometer");
    let out = this._num(cfg.outdoor);
    if (out === null && w) out = parseFloat(w.attributes.temperature);
    $("out").textContent = out === null || !Number.isFinite(out) ? "" : `${this._fmt(out)}°`;
    let hum = this._num(cfg.humidity);
    if (hum === null && Number.isFinite(parseFloat(a.current_humidity))) hum = parseFloat(a.current_humidity);
    $("hum").textContent = hum === null ? "" : `${Math.round(hum)}%`;
    $("wx").querySelector(".drop").style.display = hum === null ? "none" : "";

    // mode
    const off = st.state === "off";
    if (!off && st.state !== "unavailable" && st.state !== "unknown") (this._lastModes = this._lastModes || {})[cfg.entity] = st.state;
    const act = a.hvac_action;
    const cool = act === "cooling" || (act === undefined || act === null ? st.state === "cool" : false);
    const kind = HEAT_TYPE[this._heatType(st)];
    // the mode dot shows the kind of heat; a heat-and-cool unit takes the colour of what it is doing
    const coolNow = act === "cooling" || (st.state === "cool" && act !== "heating");
    const [mIcon, mCol] = st.state === "heat" || (kind.cool && ["heat_cool", "auto"].includes(st.state) && !coolNow) ? kind.mode
      : (st.state === "cool" || (kind.cool && coolNow)) ? (kind.cool || MODE_ICON.cool)
      : MODE_ICON[st.state] || ["mdi:thermostat", "#777"];
    $("mico").setAttribute("icon", mIcon);
    $("mdot").style.background = !kind.cool && st.state === "heat_cool" ? (act === "heating" ? "#ff7a1a" : act === "cooling" ? "#2f8cff" : mCol) : mCol;

    // preset
    const pm = a.preset_mode;
    const pEl = $("eco");
    if (!pm || pm === "none") {
      pEl.style.display = "none";
    } else {
      const [pIcon, pCol] = PRESET_ICON[pm] || ["mdi:tune-variant", "#bbb"];
      pEl.style.display = "";
      pEl.style.color = pCol;
      $("ecoi").setAttribute("icon", pIcon);
      pEl.title = this._t("presets")[pm] || pm;
    }
    pEl.classList.toggle("tap", this._presetMenuOk());
    $("ctl").textContent = this._controlLabel(st);

    // action / demand
    const dec = this._st(cfg.decision);
    const log = dec && Array.isArray(dec.attributes.log) ? dec.attributes.log : [];
    const lastLog = log.length ? log[log.length - 1] : null;
    const demand = lastLog && Number.isFinite(lastLog.demand) ? lastLog.demand : null;
    // real level for the three steps: power draw (AC / heat pump), else the demand (HC), else all three
    const power = cfg.power ? this._num(cfg.power) : null;
    const pMax = Number(cfg.power_max) || 1800, pIdle = Number(cfg.power_idle) || 40;
    let level = null;
    if (power !== null) level = power <= pIdle ? 0 : power < pMax / 3 ? 1 : power < (2 * pMax) / 3 ? 2 : 3;
    else {
      const d = this._demandPct(a) ?? demand;
      if (d !== null && d !== undefined) level = d <= 0 ? 0 : d <= 10 ? 1 : d <= 30 ? 2 : 3;
    }
    const burningSt = this._st(cfg.heating);
    const actIcon = act === "heating" || act === "preheating" ? kind.run
      : act === "cooling" ? (kind.coolRun || ACTION_ICON.cooling) : ACTION_ICON[act];
    const burning = burningSt ? burningSt.state === "on" : power !== null ? power > pIdle && !!actIcon : !!actIcon;
    const requesting = !!actIcon;
    const burnEl = $("burn");
    burnEl.style.setProperty("--act", actIcon ? actIcon[1] : "#ff8a1f");
    burnEl.querySelector("ha-icon").setAttribute("icon", actIcon ? actIcon[0] : kind.run[0]);
    burnEl.title = act || "";
    burnEl.classList.toggle("on", burning);
    burnEl.classList.toggle("req", !burning && requesting);
    const nb = level === null ? (burning || requesting ? 3 : 0) : Math.max(level, burning ? 1 : 0);
    burnEl.querySelectorAll(".bars i").forEach((el, i) => el.classList.toggle("on", i < nb && (burning || requesting)));

    // window
    let winOpen = false;
    if (cfg.window) {
      winOpen = [].concat(cfg.window).some((id) => this._st(id)?.state === "on");
    } else if (a.window_open !== undefined || a.door_open !== undefined) {
      winOpen = a.window_open === true || a.door_open === true;
    } else if (dec) {
      winOpen = dec.state === "window";
    }
    $("win").classList.toggle("on", winOpen);

    // shadow mode marker
    $("shadowm").style.display = a.hc_mode === "shadow" ? "" : "none";
    $("shadowm").title = this._t("shadow");
    $("tlist").style.display = this._manageOk() ? "" : "none";
    $("tlist").title = this._t("listTitle");

    // main numbers
    const curT = parseFloat(a.current_temperature);
    const range = this._isRange(a);
    const lo = parseFloat(a.target_temp_low), hi = parseFloat(a.target_temp_high);
    const tgt = range ? (act === "cooling" ? hi : lo) : parseFloat(a.temperature);
    const setting = this._mode === "set";
    const fieldCool = setting && this._field === "target_temp_high";
    dev.classList.toggle("cool", fieldCool);
    $("setf").textContent = !setting || !range ? "" : fieldCool ? this._t("cool") : this._t("heat");
    // SET mode: which thermostat is being set (its name, and its area when the name does not tell it)
    if (setting) {
      const fname = st.attributes.friendly_name || this._cfg.entity, area = this._entityArea(this._cfg.entity);
      $("setnt").textContent = area && !norm(fname).includes(norm(area)) ? `${area} · ${fname}` : fname;
    }
    // label: "auto" → while following, the room you are in (area_labels abbreviations); a candidate's own label wins
    let lab = this._cand && this._cand.label ? this._cand.label : cfg.label;
    if (lab === "auto") lab = this._following && this._area ? this._short(this._area) : "";
    else if (lab === "area") lab = this._short(this._entityArea(cfg.entity));
    lab = (lab ? String(lab) : "").slice(0, 6).toUpperCase();
    $("lblt").textContent = lab;
    $("lbl").style.display = lab ? "" : "none";
    const name = st.attributes.friendly_name || cfg.entity;
    $("disp").setAttribute("aria-label", setting
      ? `${name}: ${this._t("target")} ${pOffAria(this)} `
      : `${name}: ${this._fmt(parseFloat(a.current_temperature))} ${this._unit()}, ${this._t("target")} ${off ? this._t("off") : (this._isRange(a) ? `${this._fmt(parseFloat(a.target_temp_low))}–${this._fmt(parseFloat(a.target_temp_high))}` : this._fmt(parseFloat(a.temperature)))} ${this._unit()}`);
    $("subl").textContent = this._t("target");
    const pOff = setting && !this._pOn;
    dev.classList.toggle("poff", pOff);
    $("pwr").classList.toggle("on", setting && !!this._pOn);
    $("pwr").style.visibility = this._canPower(st) ? "" : "hidden";
    const U = this._unit();
    $("unit").textContent = U;
    $("pwrt").textContent = setting ? (this._pOn ? this._t("on") : this._t("off")) : "";
    $("big").innerHTML = pOff ? this._t("off") : `${this._fmt(setting && this._field ? this._pending : curT)}<sup>${U}</sup>`;
    const rd = Number.isInteger(lo) && Number.isInteger(hi) ? 0 : 1;
    $("tgt").textContent = off ? this._t("off") : range ? `${this._fmt(lo, rd)}–${this._fmt(hi, rd)}` : this._fmt(tgt);
    const was = setting && this._field ? parseFloat(a[this._field]) : tgt;
    $("cur").textContent = this._field || !setting
      ? `${this._t("now")} ${this._fmt(curT)} ${U} · ${this._t("was")} ${this._fmt(was)} ${U}`
      : `${this._t("now")} ${this._fmt(curT)} ${U}`;
    $("hint").textContent = range
      ? this._t("hintRange")
      : this._t("hint");
    $("locki").setAttribute("icon", setting ? "mdi:lock-open-variant" : "mdi:lock");
    $("lock").style.color = setting ? "#ff9a3c" : "#3d8bfd";

    // line colour
    let col = "#9bd22c";
    if (off) col = "#555";
    else if (burning) col = actIcon ? actIcon[1] : "#ff8a1f";
    else if (requesting) col = "#c9a227";
    else if (cool) col = "#2f8cff";
    else if (!act && st.state === "cool" && Number.isFinite(curT) && Number.isFinite(tgt) && curT > tgt + 0.5) col = "#64b5f6";
    else if (st.state !== "cool" && Number.isFinite(curT) && Number.isFinite(tgt) && curT < tgt - 0.5) col = "#ffb74d";
    if (!setting) $("line").style.background = col;
    else $("line").style.background = "";

    if (!keepToast) {
      if (this._mode === "saved") {
        $("toasti").setAttribute("icon", "mdi:check-circle");
        $("toastt").textContent = this._t("saved") + " " + `${this._savedVal ?? `${this._fmt(tgt)} ${this._unit()}`}`;
      } else if (this._mode === "cancel") {
        $("toasti").setAttribute("icon", "mdi:close-circle-outline");
        $("toastt").textContent = this._t("unchanged");
      }
    }
    this._renderClock();
  }
}


// ---------- Visual editor (built on HA's ha-form) ----------
const EDITOR_LABELS = {
  hu: { power: "Teljesítmény-szenzor (W; a lépcsőkhöz)", power_max: "Legnagyobb teljesítmény (W)", heat_type: "Fűtés fajtája (ikon)", ht_auto: "Automatikus (a termosztát szerint)", ht_gas_boiler: "Gázkazán", ht_floor: "Padlófűtés", ht_radiator: "Radiátor / termosztátfej", ht_heat_pump: "Hőszivattyú", ht_air_conditioner: "Klíma (fűt és hűt)", ht_electric: "Elektromos fűtés", ht_stove: "Kandalló / fatüzelés", ht_district: "Távfűtés", ht_solar: "Napkollektor", ht_flame: "Láng (régi ikon)",
    entity: "Termosztát", label: "Felirat (max 6 karakter; area = a termosztát területe)", step: "Lépésköz", heating: "Tényleges fűtés jelzője",
    weather: "Időjárás", outdoor: "Kinti hőmérő", humidity: "Páratartalom-szenzor", window: "Ablak/ajtó érzékelők", decision: "HC döntés-szenzor",
    tap_action: "Koppintás", timeout: "SET időtúllépés (mp)", switch_back: "Visszaváltás (mp)", away_hold: "Távollét kivárása (mp)",
    follow_app_only: "Csak a mobil appban kövessen", follow: "Követés: felhasználó → helyiség-szenzor (YAML)",
    rooms: "Helyiség → termosztát (YAML)", room_map: "Érték → helyiség átváltás (YAML)", area_labels: "Terület-rövidítések (YAML)",
    follow_choices: "További jeladók a készülék-menübe", follow_hint: "Helykövetés (opcionális)",
    control: "Szabályozás jelzése (auto, saját szöveg vagy false)", preset_menu: "Preset-menü a preset ikonon" },
  en: { power: "Power sensor (W; for the steps)", power_max: "Maximum power (W)", heat_type: "Kind of heat (icon)", ht_auto: "Automatic (from the thermostat)", ht_gas_boiler: "Gas boiler", ht_floor: "Floor heating", ht_radiator: "Radiator / TRV", ht_heat_pump: "Heat pump", ht_air_conditioner: "Air conditioner (heats and cools)", ht_electric: "Electric heating", ht_stove: "Fireplace / wood stove", ht_district: "District heating", ht_solar: "Solar thermal", ht_flame: "Flame (old icon)",
    entity: "Thermostat", label: "Label (max 6 chars; area = thermostat's area)", step: "Step", heating: "Actual heating sensor",
    weather: "Weather", outdoor: "Outdoor sensor", humidity: "Humidity sensor", window: "Window/door sensors", decision: "HC decision sensor",
    tap_action: "Tap action", timeout: "SET timeout (s)", switch_back: "Switch back (s)", away_hold: "Away hold (s)",
    follow_app_only: "Follow only in the mobile app", follow: "Follow: user → room sensor (YAML)",
    rooms: "Room → thermostat (YAML)", room_map: "Value → room mapping (YAML)", area_labels: "Area abbreviations (YAML)",
    follow_choices: "Extra beacons for the device menu", follow_hint: "Room following (optional)",
    control: "Control type label (auto, own text or false)", preset_menu: "Preset menu on the preset icon" },
};
class HcDialCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._update();
  }
  set hass(hass) {
    this._hass = hass;
    this._update();
  }
  _l(k) {
    const lang = (this._hass?.locale?.language || "en").slice(0, 2);
    return (EDITOR_LABELS[lang] || EDITOR_LABELS.en)[k] || k;
  }
  _schema() {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "climate" } } },
      { type: "grid", name: "", schema: [
        { name: "label", selector: { text: {} } },
        { name: "step", selector: { number: { min: 0.1, max: 5, step: 0.1, mode: "box" } } },
      ] },
      { type: "grid", name: "", schema: [
        { name: "weather", selector: { entity: { domain: "weather" } } },
        { name: "outdoor", selector: { entity: { domain: "sensor" } } },
        { name: "humidity", selector: { entity: { domain: "sensor" } } },
        { name: "heating", selector: { entity: { domain: "binary_sensor" } } },
      ] },
      { type: "grid", name: "", schema: [
        { name: "power", selector: { entity: { domain: "sensor" } } },
        { name: "power_max", selector: { number: { min: 100, max: 20000, step: 50, mode: "box" } } },
      ] },
      { name: "heat_type", selector: { select: { mode: "dropdown", options: HEAT_TYPES.map((v) => ({ value: v, label: this._l("ht_" + v) })) } } },
      { name: "window", selector: { entity: { domain: "binary_sensor", multiple: true } } },
      { name: "tap_action", selector: { select: { mode: "dropdown", options: ["auto", "more-info", "cycle", "none"] } } },
      { type: "grid", name: "", schema: [
        { name: "control", selector: { text: {} } },
        { name: "preset_menu", selector: { boolean: {} } },
      ] },
      { type: "grid", name: "", schema: [
        { name: "timeout", selector: { number: { min: 5, max: 120, mode: "box" } } },
        { name: "switch_back", selector: { number: { min: 3, max: 120, mode: "box" } } },
      ] },
      { type: "expandable", name: "", title: this._l("follow_hint"), schema: [
        { name: "follow", selector: { object: {} } },
        { name: "follow_app_only", selector: { boolean: {} } },
        { name: "rooms", selector: { object: {} } },
        { name: "room_map", selector: { object: {} } },
        { name: "area_labels", selector: { object: {} } },
        { name: "follow_choices", selector: { entity: { domain: "sensor", multiple: true } } },
        { name: "away_hold", selector: { number: { min: 0, max: 600, mode: "box" } } },
        { name: "decision", selector: { entity: { domain: "sensor" } } },
      ] },
    ];
  }
  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    // ha-form is loaded by a built-in card's editor
    try {
      const h = await window.loadCardHelpers();
      const c = await h.createCardElement({ type: "entities", entities: [] });
      if (c && c.constructor.getConfigElement) await c.constructor.getConfigElement();
    } catch (e) { /* YAML only */ }
  }
  async _update() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      await this._ensureForm();
      if (this._form) return;
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (sc) => this._l(sc.name);
      this._form.addEventListener("value-changed", (e) => {
        const cfg = { ...e.detail.value };
        for (const k of Object.keys(cfg)) if (cfg[k] === "" || cfg[k] === null || cfg[k] === undefined) delete cfg[k];
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
      });
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = this._schema();
    if (!this._form.isConnected) this.appendChild(this._form); // attach only after hass is set
  }
}
customElements.define("hc-dial-card-editor", HcDialCardEditor);

customElements.define("hc-dial-card", HcDialCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "hc-dial-card",
  name: "HC Dial Card",
  description: "Round wall-thermostat card for any climate entity: long press → SET, turn the ring, long press → save. Optional room following.",
  preview: true,
});
console.info(`%c HC-DIAL-CARD %c ${HC_DIAL_VERSION} `, "background:#ff7a1a;color:#000", "background:#222;color:#fff");
