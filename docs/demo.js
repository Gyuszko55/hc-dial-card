// HC Dial Card demo: the released card on simulated thermostats – a tiny stand-in for Home Assistant.
(() => {
  "use strict";
  const SRC = window.HC_DIAL_DEMO_SRC || "hc-dial-card.js";
  const SPEED = 30; // simulated seconds per real second
  const TICK = 2000; // ms

  // ---- the two Home Assistant elements the card uses ------------------------------------------------------------
  const MDI_CSS = "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css";
  class DemoIcon extends HTMLElement {
    static get observedAttributes() { return ["icon"]; }
    constructor() {
      super();
      const r = this.attachShadow({ mode: "open" });
      r.innerHTML = `<link rel="stylesheet" href="${MDI_CSS}"><style>:host{display:inline-flex;align-items:center;justify-content:center;
        width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);vertical-align:middle}
        i{font-size:var(--mdc-icon-size,24px);line-height:1;display:block}i::before{display:block}</style><i></i>`;
      this._i = r.querySelector("i");
    }
    attributeChangedCallback() { this._draw(); }
    set icon(v) { this.setAttribute("icon", v || ""); }
    get icon() { return this.getAttribute("icon") || ""; }
    _draw() { this._i.className = "mdi " + this.icon.replace(/^mdi:/, "mdi-"); }
  }
  if (!customElements.get("ha-icon")) customElements.define("ha-icon", DemoIcon);
  if (!customElements.get("ha-card")) customElements.define("ha-card", class extends HTMLElement {
    connectedCallback() { this.style.display = "block"; }
  });

  // ---- simulated home ------------------------------------------------------------------------------------------------
  const iso = (h) => { const d = new Date(Date.now() + h * 3600e3); d.setMinutes(0, 0, 0); return d.toISOString(); };
  const PRESETS = ["comfort", "home", "sleep", "eco", "away", "vacation", "boost"];
  const PRESET_TEMP = { comfort: 22.5, home: 21.5, sleep: 19.5, eco: 19, away: 17, vacation: 15, boost: 24 };
  const ENDS = () => ({ comfort: "PT3H", home: iso(9), sleep: iso(8), eco: iso(9), away: null, vacation: null, boost: "PT1H" });
  const HC = (o) => ({ hc_mode: "active", demand: 0, control_type: "pid", supported_features: 401, min_temp: 5, max_temp: 30,
    target_temp_step: 0.5, preset_modes: PRESETS, preset_mode: "home", preset_end_preview: ENDS(), temperature_unit: "°C", ...o });

  const START = () => ({
    "climate.living_room": { state: "heat", attributes: HC({ friendly_name: "Living room", hvac_modes: ["heat", "off"],
      current_temperature: 20.1, temperature: 21.5, hvac_action: "heating", heat_type: "gas_boiler", trv_heads: ["climate.bedroom_trv"],
      leading_room: "Living room", current_humidity: 46 }) },
    "climate.bedroom_trv": { state: "heat", attributes: { friendly_name: "Bedroom radiator", hvac_modes: ["heat", "off"],
      current_temperature: 18.6, temperature: 19.5, hvac_action: "heating", min_temp: 5, max_temp: 30, target_temp_step: 0.5,
      supported_features: 385 } },
    "climate.terrace_ac": { state: "cool", attributes: HC({ friendly_name: "Terrace AC", hvac_modes: ["heat", "cool", "off"],
      current_temperature: 24.6, temperature: 23, hvac_action: "cooling", heat_type: "air_conditioner", control_type: "ac",
      supervision_switch: "switch.terrace_ac_pause", supervision_paused: false, trv_heads: null }) },
    "climate.study": { state: "heat", attributes: { friendly_name: "Study", hvac_modes: ["heat", "off"], current_temperature: 19.4,
      temperature: 20.5, hvac_action: "heating", min_temp: 7, max_temp: 35, target_temp_step: 0.5, supported_features: 401,
      preset_modes: ["none", "away", "eco", "comfort"], preset_mode: "none" } },
    "switch.terrace_ac_pause": { state: "off", attributes: { friendly_name: "Terrace AC supervision paused" } },
    "binary_sensor.boiler_burning": { state: "on", attributes: { friendly_name: "Boiler burning" } },
    "sensor.living_room_decision": { state: "regulating", attributes: { friendly_name: "Living room decision", log: [] } },
    "sensor.terrace_ac_power": { state: "820", attributes: { unit_of_measurement: "W", friendly_name: "Terrace AC power" } },
    "sensor.study_heater_power": { state: "1500", attributes: { unit_of_measurement: "W", friendly_name: "Study heater power" } },
    "weather.home": { state: "partlycloudy", attributes: { temperature: 8.5, humidity: 76, friendly_name: "Home" } },
    "sensor.outdoor_temperature": { state: "8.5", attributes: { unit_of_measurement: "°C", device_class: "temperature" } },
    "sensor.outdoor_humidity": { state: "76", attributes: { unit_of_measurement: "%", device_class: "humidity" } },
  });
  const ENTITIES = {
    "climate.living_room": { platform: "hc_thermostat", area_id: "living_room" },
    "climate.bedroom_trv": { platform: "mqtt", area_id: "bedroom" },
    "climate.terrace_ac": { platform: "hc_thermostat", area_id: "terrace" },
    "climate.study": { platform: "generic_thermostat", area_id: "study" },
  };
  const AREAS = { living_room: { area_id: "living_room", name: "Living room" }, bedroom: { area_id: "bedroom", name: "Bedroom" },
    terrace: { area_id: "terrace", name: "Terrace" }, study: { area_id: "study", name: "Study" } };

  let states = {};
  let exact = {}; // room temperatures before rounding to 0.1
  let lang = "en";
  const cards = [];
  const stamp = (s) => { const t = new Date().toISOString(); for (const id of Object.keys(s)) s[id] = { entity_id: id, last_changed: t, last_updated: t, context: { id: "demo" }, ...s[id] }; return s; };
  const set = (id, state, attrs) => {
    const old = states[id];
    const t = new Date().toISOString();
    states = { ...states, [id]: { ...old, state: state ?? old.state, attributes: { ...old.attributes, ...(attrs || {}) },
      last_updated: t, last_changed: state !== undefined && state !== old.state ? t : old.last_changed } };
  };

  // ---- services --------------------------------------------------------------------------------------------------------
  const toast = (msg) => { const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("on");
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), 2600); };
  async function callService(domain, service, data) {
    const id = data.entity_id;
    const st = states[id];
    if (!st) return;
    if (domain === "climate") {
      if (service === "set_temperature") {
        const a = {};
        for (const k of ["temperature", "target_temp_low", "target_temp_high"]) if (k in data) a[k] = data[k];
        if (st.attributes.hc_mode !== undefined && st.attributes.preset_modes) a.preset_mode = st.attributes.preset_mode; // HC keeps the preset
        set(id, data.hvac_mode, a);
      } else if (service === "set_hvac_mode") set(id, data.hvac_mode);
      else if (service === "turn_off") set(id, "off");
      else if (service === "turn_on") set(id, st.attributes.hvac_modes.find((m) => m !== "off"));
      else if (service === "set_preset_mode") {
        const p = data.preset_mode;
        set(id, undefined, { preset_mode: p, ...(PRESET_TEMP[p] && st.attributes.hc_mode !== undefined ? { temperature: PRESET_TEMP[p] } : {}) });
      }
    } else if (domain === "switch") {
      set(id, service === "turn_on" ? "on" : "off");
      if (id === "switch.terrace_ac_pause") set("climate.terrace_ac", undefined, { supervision_paused: service === "turn_on" });
    }
    simulate(0);
    push();
  }
  async function callWS(msg) { throw new Error(`not in the demo: ${msg && msg.type}`); }

  // ---- physics: a few lines, good enough to watch -------------------------------------------------------------------
  const r1 = (v) => Math.round(v * 100) / 100;
  function simulate(dt) {
    const out = parseFloat(states["sensor.outdoor_temperature"].state);
    for (const id of ["climate.living_room", "climate.bedroom_trv", "climate.terrace_ac", "climate.study"]) {
      const st = states[id], a = st.attributes;
      const cur = exact[id] ?? a.current_temperature, tgt = a.temperature;
      const paused = a.supervision_paused === true;
      let act = "idle", rate = 0;
      if (st.state === "heat" && cur < tgt - 0.05) { act = "heating"; rate = id === "climate.terrace_ac" ? 1.2 : 0.8; }
      else if (st.state === "cool" && cur > tgt + 0.05) { act = "cooling"; rate = -1.2; }
      else if (st.state === "off") act = "off";
      if (paused && st.state !== "off") act = a.hvac_action; // the AC runs on its own logic while HC is paused
      // °C per simulated hour → per tick; heat loss towards outside (or, in summer mode, towards 28 °C)
      const env = st.state === "cool" ? 28 : out;
      const loss = (env - cur) * 0.01;
      const next = r1(cur + ((act === "heating" ? rate : act === "cooling" ? rate : 0) + loss) * (dt * SPEED / 3600) * 12);
      const demand = act === "heating" || act === "cooling" ? Math.min(100, Math.max(8, Math.round(Math.abs(tgt - cur) * 60))) : 0;
      exact[id] = next;
      set(id, undefined, { current_temperature: Math.round(next * 10) / 10, hvac_action: act,
        ...(a.hc_mode !== undefined ? { demand } : {}) });
    }
    const lr = states["climate.living_room"].attributes;
    const burning = lr.hvac_action === "heating" || states["climate.bedroom_trv"].attributes.hvac_action === "heating";
    set("binary_sensor.boiler_burning", burning ? "on" : "off");
    const log = [...(states["sensor.living_room_decision"].attributes.log || []).slice(-9),
      { time: new Date().toISOString(), reason: burning ? "regulating" : "at_target", demand: lr.demand }];
    set("sensor.living_room_decision", burning ? "regulating" : "at_target", { log });
    const ac = states["climate.terrace_ac"].attributes;
    const acW = ac.hvac_action === "heating" || ac.hvac_action === "cooling" ? 300 + Math.round(ac.demand * 14) : 9;
    set("sensor.terrace_ac_power", String(acW));
    set("sensor.study_heater_power", states["climate.study"].attributes.hvac_action === "heating" ? "1500" : "0");
  }

  // ---- hass object -----------------------------------------------------------------------------------------------------
  function hass() {
    return {
      states, entities: ENTITIES, areas: AREAS, devices: {},
      user: { id: "demo", name: "Demo", is_admin: true },
      language: lang, locale: { language: lang, number_format: "language", time_format: "24" },
      config: { unit_system: { temperature: "°C" }, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone, version: "2026.11.0" },
      themes: { darkMode: true }, callService, callWS,
    };
  }
  const push = () => { const h = hass(); for (const c of cards) c.hass = h; };

  // ---- cards ------------------------------------------------------------------------------------------------------------
  const LABELS = { "Living room": "LIVING", Bedroom: "BEDRM", Terrace: "TERR", Study: "STUDY" };
  const CONFIGS = {
    c1: { entity: "climate.living_room", weather: "weather.home", outdoor: "sensor.outdoor_temperature", humidity: "sensor.outdoor_humidity",
      heating: "binary_sensor.boiler_burning", decision: "sensor.living_room_decision", label: "area", manage: false, timeout: 15, area_labels: LABELS,
      rooms: { Bedroom: { entity: "climate.bedroom_trv", trv: true },
        Terrace: { entity: "climate.terrace_ac", power: "sensor.terrace_ac_power", power_max: 1800 } } },
    c2: { entity: "climate.terrace_ac", weather: "weather.home", outdoor: "sensor.outdoor_temperature", label: "area", manage: false, area_labels: LABELS,
      power: "sensor.terrace_ac_power", power_max: 1800, timeout: 15 },
    c3: { entity: "climate.study", outdoor: "sensor.outdoor_temperature", label: "area", manage: false, heat_type: "electric",
      power: "sensor.study_heater_power", power_max: 2000, timeout: 15 },
  };
  function build() {
    cards.length = 0;
    const h = hass();
    for (const [slot, cfg] of Object.entries(CONFIGS)) {
      const box = document.getElementById(slot);
      box.textContent = "";
      const c = document.createElement("hc-dial-card");
      c.setConfig(cfg);
      c.hass = h;
      box.appendChild(c);
      cards.push(c);
    }
  }

  // ---- what the card asks of Home Assistant: more-info and the HC info panel -----------------------------------------
  const home = location.pathname + location.search;
  window.addEventListener("location-changed", () => {
    const m = /\/hc-info\?entity=([^&]+)/.exec(location.pathname + location.search);
    history.replaceState(null, "", home);
    if (m) showInfo(decodeURIComponent(m[1]));
  });
  document.addEventListener("hass-more-info", (e) => {
    const id = e.detail && e.detail.entityId;
    toast(`In Home Assistant this opens the more-info dialog of ${states[id]?.attributes.friendly_name || id}.`);
  });
  function showInfo(id) {
    const st = states[id];
    if (!st) return;
    document.getElementById("infot").textContent = `HC info – ${st.attributes.friendly_name}`;
    const tab = document.getElementById("infotab");
    tab.textContent = "";
    const row = (k, v) => { const tr = tab.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; };
    row("state", st.state);
    for (const [k, v] of Object.entries(st.attributes)) row(k, v === null ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));
    document.getElementById("info").showModal();
  }
  document.getElementById("infox").addEventListener("click", () => document.getElementById("info").close());

  // ---- controls -------------------------------------------------------------------------------------------------------
  const pickLang = () => {
    const want = (navigator.language || "en").toLowerCase();
    if (want.startsWith("sr-latn")) return "sr-Latn";
    const two = want.slice(0, 2);
    return ["en", "hu", "de", "sr"].includes(two) ? two : "en";
  };
  const sel = document.getElementById("lang");
  sel.addEventListener("change", () => { lang = sel.value; build(); });
  document.getElementById("reset").addEventListener("click", () => { states = stamp(START()); exact = {}; build(); toast("Reset"); });

  // ---- start ----------------------------------------------------------------------------------------------------------
  const s = document.createElement("script");
  s.src = SRC;
  s.onload = () => {
    customElements.whenDefined("hc-dial-card").then(() => {
      lang = pickLang();
      sel.value = lang;
      states = stamp(START());
      simulate(0);
      build();
      const v = String(window.HC_DIAL_VERSION || (SRC.match(/@v([\d.]+)/) || [])[1] || "");
      document.getElementById("ver").textContent = v ? `v${v}` : "";
      setInterval(() => { simulate(TICK / 1000); push(); }, TICK);
    });
  };
  s.onerror = () => toast("The card could not be loaded.");
  document.head.appendChild(s);
})();
