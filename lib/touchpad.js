'use strict';
// Touchpad bridge (owner 2026-10-10): Windows sends no touchpad gestures to apps, so the app reads the Precision
// Touchpad's raw HID reports itself (Raw Input, RIDEV_INPUTSINK = also while another app has focus) through koffi, and
// counts the fingers touching the pad. main.js feeds that count to lib/gesture.js tapStep (hold + double tap).
// Read-only: the touchpad keeps working exactly as before (pointer, scroll, Windows' own gestures). Any failure (no
// touchpad, no koffi, an odd report) just means no gesture: start() returns false or the reports are skipped.
const WM_INPUT = 0x00FF;
const RIDEV_INPUTSINK = 0x100, RID_INPUT = 0x10000003, RIDI_PREPARSEDDATA = 0x20000005;
const HID_DIGITIZER = 0x0D, PRECISION_TOUCHPAD = 0x05, FINGER = 0x22, TIP_SWITCH = 0x42, CONTACT_ID = 0x51, CONTACT_COUNT = 0x54;
const HIDP_OK = 0x00110000, HDR = 24, NODE = 24; // sizeof(RAWINPUTHEADER) / sizeof(HIDP_LINK_COLLECTION_NODE) on x64

let api = null;
function load() {
  if (api) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll'), hid = koffi.load('hid.dll');
  const RAWINPUTDEVICE = koffi.struct('RAWINPUTDEVICE', { usUsagePage: 'uint16', usUsage: 'uint16', dwFlags: 'uint32', hwndTarget: 'uintptr_t' });
  api = {
    devSize: koffi.sizeof(RAWINPUTDEVICE),
    register: user32.func('bool __stdcall RegisterRawInputDevices(RAWINPUTDEVICE *devs, uint32_t n, uint32_t size)'),
    data: user32.func('uint32_t __stdcall GetRawInputData(uintptr_t h, uint32_t cmd, void *buf, _Inout_ uint32_t *size, uint32_t hdr)'),
    info: user32.func('uint32_t __stdcall GetRawInputDeviceInfoW(uintptr_t dev, uint32_t cmd, void *buf, _Inout_ uint32_t *size)'),
    nodes: hid.func('uint32_t __stdcall HidP_GetLinkCollectionNodes(void *nodes, _Inout_ uint32_t *len, void *pp)'),
    value: hid.func('uint32_t __stdcall HidP_GetUsageValue(int type, uint16_t page, uint16_t lc, uint16_t usage, _Out_ uint32_t *val, void *pp, void *rep, uint32_t len)'),
    usages: hid.func('uint32_t __stdcall HidP_GetUsages(int type, uint16_t page, uint16_t lc, void *list, _Inout_ uint32_t *len, void *pp, void *rep, uint32_t len2)')
  };
  return api;
}

// per touchpad: its preparsed data + the link collections that each describe one finger
const devices = new Map();
function device(h) {
  const k = String(h);
  if (devices.has(k)) return devices.get(k);
  const a = load(), size = [0];
  a.info(h, RIDI_PREPARSEDDATA, null, size);
  const pp = Buffer.alloc(size[0]);
  if (!size[0] || a.info(h, RIDI_PREPARSEDDATA, pp, size) === 0xFFFFFFFF) { devices.set(k, null); return null; }
  const n = [64], buf = Buffer.alloc(64 * NODE), fingers = [];
  if (a.nodes(buf, n, pp) === HIDP_OK) {
    for (let i = 0; i < n[0]; i++) if (buf.readUInt16LE(i * NODE) === FINGER && buf.readUInt16LE(i * NODE + 2) === HID_DIGITIZER) fingers.push(i);
  }
  const d = fingers.length ? { pp, fingers, down: new Map(), left: 0 } : null;
  devices.set(k, d);
  return d;
}

// one HID report → update which contacts are down. Hybrid mode: the first report of a frame carries the contact count,
// the frame's later reports carry 0 and the remaining contacts.
function readReport(d, rep) {
  const a = load(), v = [0];
  if (a.value(0, HID_DIGITIZER, 0, CONTACT_COUNT, v, d.pp, rep, rep.length) === HIDP_OK && v[0] > 0) d.left = v[0];
  const n = Math.min(d.fingers.length, d.left);
  d.left -= n;
  for (let i = 0; i < n; i++) {
    const lc = d.fingers[i], id = [0], list = Buffer.alloc(32), len = [16];
    if (a.value(0, HID_DIGITIZER, lc, CONTACT_ID, id, d.pp, rep, rep.length) !== HIDP_OK) continue;
    let tip = false;
    if (a.usages(0, HID_DIGITIZER, lc, list, len, d.pp, rep, rep.length) === HIDP_OK) {
      for (let j = 0; j < len[0]; j++) if (list.readUInt16LE(j * 2) === TIP_SWITCH) tip = true;
    }
    if (tip) d.down.set(id[0], true); else d.down.delete(id[0]);
  }
  return d.down.size;
}

// win = any BrowserWindow that lives as long as the app (its HWND receives WM_INPUT even while hidden).
// onFingers(count) runs on every report. Returns true when the touchpad listener is on.
function start(win, onFingers, log = () => {}) {
  let a;
  try { a = load(); } catch (e) { log('TOUCHPAD-OFF koffi ' + e.message); return false; }
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
  const dev = { usUsagePage: HID_DIGITIZER, usUsage: PRECISION_TOUCHPAD, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd };
  if (!a.register([dev], 1, a.devSize)) { log('TOUCHPAD-OFF register failed'); return false; }
  let warned = false;
  win.hookWindowMessage(WM_INPUT, (_w, lParam) => {
    try {
      const h = lParam.readBigUInt64LE(0), size = [0];
      a.data(h, RID_INPUT, null, size, HDR);
      if (!size[0]) return;
      const buf = Buffer.alloc(size[0]);
      if (a.data(h, RID_INPUT, buf, size, HDR) === 0xFFFFFFFF || buf.readUInt32LE(0) !== 2) return; // 2 = RIM_TYPEHID
      const d = device(buf.readBigUInt64LE(8));
      if (!d) return;
      const each = buf.readUInt32LE(HDR), count = buf.readUInt32LE(HDR + 4);
      for (let i = 0; i < count; i++) onFingers(readReport(d, Buffer.from(buf.subarray(HDR + 8 + i * each, HDR + 8 + (i + 1) * each))));
    } catch (e) { if (!warned) { warned = true; log('TOUCHPAD-READ-FAIL ' + e.message); } }
  });
  log('TOUCHPAD-ON');
  return true;
}

module.exports = { start };
