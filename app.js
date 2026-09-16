/* CountQC — mobile QC counting & statistics
 * Pure vanilla JS, persisted to localStorage. No build step. */
(function () {
  "use strict";

  var STORE_KEY = "countqc.v1";

  /* ---------- State ---------- */
  var state = {
    recordName: "",     // free-text name shown in the header
    values: [],   // array of numbers, in entry order
    lsl: "",
    usl: "",
    mode: "quick",      // "quick" (value buttons) or "manual" (keypad)
    gridMin: null,      // lowest value button
    gridMax: null,      // highest value button
    step: 0.1           // user-chosen spacing between value buttons
  };

  /* ---------- Element refs ---------- */
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    recordName: $("recordName"),
    lowEntry: $("lowEntry"), highEntry: $("highEntry"), stepInput: $("stepInput"),
    bigCount: $("bigCount"),
    qsAvg: $("qsAvg"), qsMin: $("qsMin"), qsMax: $("qsMax"),
    modeQuick: $("modeQuick"), modeManual: $("modeManual"),
    quickPane: $("quickPane"), manualPane: $("manualPane"),
    valueGrid: $("valueGrid"), addLower: $("addLower"), addHigher: $("addHigher"),
    lowerLess: $("lowerLess"), higherLess: $("higherLess"),
    quickHint: $("quickHint"),
    entryForm: $("entryForm"),
    entryInput: $("entryInput"),
    keypad: $("keypad"),
    keypadActions: $("keypadActions"),
    valuesList: $("valuesList"),
    undoBtn: $("undoBtn"),
    clearBtn: $("clearBtn"),
    // summary
    summaryTitle: $("summaryTitle"),
    sumCount: $("sumCount"), sumAvg: $("sumAvg"), sumMin: $("sumMin"),
    sumMax: $("sumMax"), sumRange: $("sumRange"),
    sumMedian: $("sumMedian"), sumMode: $("sumMode"),
    lslInput: $("lslInput"), uslInput: $("uslInput"),
    pctUnder: $("pctUnder"), pctIn: $("pctIn"), pctInLeg: $("pctInLeg"), pctOver: $("pctOver"),
    specRing: $("specRing"),
    histogram: $("histogram"),
    histLegend: $("histLegend"),
    allValuesList: $("allValuesList"),
    exportBtn: $("exportBtn"),
    // nav
    pageEntry: $("pageEntry"), pageSummary: $("pageSummary"),
    tabEntry: $("tabEntry"), tabSummary: $("tabSummary")
  };

  /* ---------- Persistence ---------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.values)) {
        state.recordName = parsed.recordName || "";
        state.values = parsed.values.filter(function (n) { return typeof n === "number" && isFinite(n); });
        state.lsl = parsed.lsl || "";
        state.usl = parsed.usl || "";
        state.mode = parsed.mode === "manual" ? "manual" : "quick";
        state.gridMin = typeof parsed.gridMin === "number" ? parsed.gridMin : null;
        state.gridMax = typeof parsed.gridMax === "number" ? parsed.gridMax : null;
        state.step = typeof parsed.step === "number" && parsed.step > 0 ? parsed.step : 0.1;
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- Number formatting ---------- */
  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) return "–";
    // Trim to at most 4 decimals, drop trailing zeros.
    var r = Math.round(n * 10000) / 10000;
    return String(r);
  }

  /* ---------- Stats ---------- */
  function stats(arr) {
    var n = arr.length;
    if (n === 0) return { n: 0 };
    var sum = 0, min = Infinity, max = -Infinity;
    for (var i = 0; i < n; i++) {
      var v = arr[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    var avg = sum / n;
    var sq = 0;
    for (var j = 0; j < n; j++) { var d = arr[j] - avg; sq += d * d; }
    // Sample standard deviation (n-1); falls back to 0 when n === 1.
    var std = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;

    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(n / 2);
    var median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

    // Mode: most frequent value. Ties resolve to the smallest. No repeat → null.
    var counts = {}, modeVal = null, modeCount = 0;
    for (var k = 0; k < n; k++) {
      var key = sorted[k];
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > modeCount) { modeCount = counts[key]; modeVal = key; }
    }
    var mode = modeCount > 1 ? modeVal : null;

    return {
      n: n, sum: sum, avg: avg, min: min, max: max, range: max - min,
      std: std, median: median, mode: mode, modeCount: modeCount
    };
  }

  /* ---------- Parse user input (one or many numbers) ---------- */
  function parseNumbers(text) {
    if (!text) return [];
    var tokens = text.split(/[\s,;]+/);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].trim();
      if (t === "") continue;
      var v = Number(t);
      if (isFinite(v)) out.push(v);
    }
    return out;
  }

  /* ---------- Render: entry page ---------- */
  function updateStatline() {
    var s = stats(state.values);
    els.bigCount.textContent = state.values.length;
    els.qsAvg.textContent = s.n ? fmt(s.avg) : "–";
    els.qsMin.textContent = s.n ? fmt(s.min) : "–";
    els.qsMax.textContent = s.n ? fmt(s.max) : "–";
  }

  function renderEntry() {
    updateStatline();
    renderModePanes();
    renderValueGrid();
  }

  /* ---------- Quick-tap value buttons ---------- */
  // Parse a spec like "8.50-9.00" (or "8.5 to 9") into low/high.
  function parseRange(text) {
    var m = String(text || "").match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i);
    if (!m) return null;
    var lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    if (!isFinite(lo) || !isFinite(hi)) return null;
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    return { lo: lo, hi: hi };
  }

  function inferStep(range) {
    if (range <= 0) return 0.1;
    var raw = range / 5;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var nrm = raw / mag, nice;
    if (nrm < 1.5) nice = 1;
    else if (nrm < 3) nice = 2;
    else if (nrm < 7) nice = 5;
    else nice = 10;
    return nice * mag;
  }

  function snap(v, step, dec) {
    return Number((Math.round(v / step) * step).toFixed(dec));
  }

  var GRID_STEP = 0.1;          // value buttons are always 0.1 apart
  var GRID_MARGIN_STEPS = 3;    // how many buttons to show beyond each limit

  function specDisplay() {
    return (state.lsl !== "" && state.usl !== "") ? state.lsl + "–" + state.usl : "";
  }

  // The user-chosen interval between value buttons (defaults to 0.1).
  function userStep() {
    var s = Number(state.step);
    return isFinite(s) && s > 0 ? s : 0.1;
  }

  // Count the decimal places of a number (handles steps like 0.25).
  function decimalsOf(n) {
    var s = String(n);
    var i = s.indexOf(".");
    return i < 0 ? 0 : Math.min(s.length - i - 1, 6);
  }

  // Build the value-button range from the current LSL/USL and step.
  function rebuildGrid() {
    var step = userStep();
    var lo = Number(state.lsl), hi = Number(state.usl);
    if (state.lsl === "" || state.usl === "" || !isFinite(lo) || !isFinite(hi)) {
      state.gridMin = state.gridMax = null;
      return;
    }
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    var dec = decimalsOf(step);
    state.gridMin = snap(lo - GRID_MARGIN_STEPS * step, step, dec);
    state.gridMax = snap(hi + GRID_MARGIN_STEPS * step, step, dec);
  }

  // Mirror the limit value into all four inputs except the one being edited.
  function syncLimitInputs(except) {
    [els.lowEntry, els.lslInput].forEach(function (el) { if (el && el !== except) el.value = state.lsl; });
    [els.highEntry, els.uslInput].forEach(function (el) { if (el && el !== except) el.value = state.usl; });
  }

  function gridValues() {
    if (state.gridMin == null || state.gridMax == null) return [];
    var step = userStep();
    var dec = decimalsOf(step);
    var n = Math.round((state.gridMax - state.gridMin) / step);
    if (n < 0) n = 0;
    if (n > 400) n = 400; // safety cap
    var out = [];
    for (var i = 0; i <= n; i++) {
      out.push(Number((state.gridMin + i * step).toFixed(dec)));
    }
    return out;
  }

  function classForValue(v) {
    var lsl = state.lsl === "" ? null : Number(state.lsl);
    var usl = state.usl === "" ? null : Number(state.usl);
    if (lsl !== null && isFinite(lsl) && v < lsl) return "vbtn--under";
    if (usl !== null && isFinite(usl) && v > usl) return "vbtn--over";
    if ((lsl !== null && isFinite(lsl)) || (usl !== null && isFinite(usl))) return "vbtn--in";
    return "";
  }

  function renderValueGrid() {
    var vals = gridValues();
    var hasGrid = vals.length > 0;
    var dec = decimalsOf(userStep());
    els.valueGrid.innerHTML = "";
    els.quickHint.style.display = hasGrid ? "none" : "";
    els.addLower.style.display = hasGrid ? "" : "none";
    els.addHigher.style.display = hasGrid ? "" : "none";
    els.lowerLess.style.display = hasGrid ? "" : "none";
    els.higherLess.style.display = hasGrid ? "" : "none";

    for (var i = 0; i < vals.length; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vbtn " + classForValue(vals[i]);
      b.textContent = vals[i].toFixed(dec); // consistent decimals, e.g. 8.0
      b.dataset.val = String(vals[i]);
      els.valueGrid.appendChild(b);
    }

    layoutValueGrid(vals.length);
  }

  // Fill numbers down each column, adding columns across the width so they all
  // stay on screen. Buttons always keep the same width:height rectangle as a
  // manual-mode number key (3 equal columns at 56px tall), just scaled to
  // whatever size lets them all fit the fixed workspace.
  function layoutValueGrid(n) {
    if (!n) {
      els.valueGrid.style.gridTemplateRows = "";
      els.valueGrid.style.gridTemplateColumns = "";
      els.valueGrid.style.overflowY = "hidden";
      return;
    }
    var gap = 8, minW = 46, maxW = 150;
    var gw = els.valueGrid.clientWidth || ((window.innerWidth || 360) - 28);
    var gh = els.valueGrid.clientHeight || 240;

    // Manual key proportions: 3 equal columns at a 56px row.
    var ratio = ((gw - 2 * gap) / 3) / 56;
    if (!isFinite(ratio) || ratio <= 0) ratio = 2;

    var maxColsByWidth = Math.max(1, Math.floor((gw + gap) / (minW + gap)));
    var cols = 1, cw = gw, ch = cw / ratio, rows = n, fit = false;
    for (cols = 1; cols <= Math.max(maxColsByWidth, n); cols++) {
      cw = (gw - (cols - 1) * gap) / cols;
      if (cw < minW) { cols = Math.max(1, cols - 1); cw = (gw - (cols - 1) * gap) / cols; break; }
      ch = cw / ratio;
      rows = Math.ceil(n / cols);
      var neededH = rows * ch + (rows - 1) * gap;
      if (cw <= maxW && neededH <= gh) { fit = true; break; }
    }
    if (!fit) {
      // Even the narrowest packing overflows: use as many columns as fit and scroll.
      cols = Math.max(1, Math.min(maxColsByWidth, n));
      cw = (gw - (cols - 1) * gap) / cols;
      ch = cw / ratio;
      rows = Math.ceil(n / cols);
    }

    els.valueGrid.style.gridTemplateColumns = "repeat(" + cols + ", " + cw.toFixed(2) + "px)";
    els.valueGrid.style.gridAutoColumns = cw.toFixed(2) + "px";
    els.valueGrid.style.gridTemplateRows = "repeat(" + rows + ", " + ch.toFixed(2) + "px)";
    els.valueGrid.style.setProperty("--vbtn-font", Math.round(Math.min(22, Math.max(14, ch * 0.36))) + "px");
    // If even the narrowest packing can't fit every row, allow a gentle scroll
    // so every button is still reachable.
    var needed = rows * ch + (rows - 1) * gap;
    els.valueGrid.style.overflowY = needed > gh ? "auto" : "hidden";
  }

  function renderModePanes() {
    var quick = state.mode !== "manual";
    els.quickPane.classList.toggle("hidden", !quick);
    els.manualPane.classList.toggle("hidden", quick);
    els.modeQuick.classList.toggle("is-active", quick);
    els.modeManual.classList.toggle("is-active", !quick);
  }

  function setMode(m) {
    state.mode = m === "manual" ? "manual" : "quick";
    save();
    renderModePanes();
    if (state.mode === "quick") renderValueGrid();
    else els.entryInput.focus();
  }

  function recordValue(v, btn) {
    state.values.push(v);
    save();
    updateStatline();
    if (btn) {
      btn.classList.add("is-hit");
      setTimeout(function () { btn.classList.remove("is-hit"); }, 180);
    }
  }

  function extendGrid(dir) {
    if (state.gridMin == null) return;
    var step = userStep(), dec = decimalsOf(step);
    if (dir < 0) state.gridMin = Number((state.gridMin - step).toFixed(dec));
    else state.gridMax = Number((state.gridMax + step).toFixed(dec));
    save();
    renderValueGrid();
  }

  // Remove the outermost button on one side, but never past the spec limit.
  function shrinkGrid(dir) {
    if (state.gridMin == null) return;
    var step = userStep(), dec = decimalsOf(step);
    var lo = Number(state.lsl), hi = Number(state.usl);
    if (dir < 0) {
      if (isFinite(lo) && state.gridMin < lo - 1e-9) {
        state.gridMin = Number((state.gridMin + step).toFixed(dec));
      }
    } else {
      if (isFinite(hi) && state.gridMax > hi + 1e-9) {
        state.gridMax = Number((state.gridMax - step).toFixed(dec));
      }
    }
    save();
    renderValueGrid();
  }

  /* ---------- Render: summary page ---------- */
  function renderSummary() {
    var s = stats(state.values);
    var title = state.recordName.trim() || specDisplay();
    els.summaryTitle.textContent = title ? "Summary — " + title : "Summary";

    els.sumCount.textContent = s.n || 0;
    els.sumAvg.textContent = s.n ? fmt(s.avg) : "–";
    els.sumMedian.textContent = s.n ? fmt(s.median) : "–";
    els.sumMode.textContent = s.n ? (s.mode === null ? "—" : fmt(s.mode)) : "–";
    els.sumMin.textContent = s.n ? fmt(s.min) : "–";
    els.sumMax.textContent = s.n ? fmt(s.max) : "–";
    els.sumRange.textContent = s.n ? fmt(s.range) : "–";

    renderSpec(s);
    renderHistogram(s);
    renderAllValues();
  }

  /* ---------- Histogram (frequency distribution) ---------- */
  function niceWidth(range, target) {
    if (range <= 0) return 1;
    var raw = range / target;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    else nice = 10;
    return nice * mag;
  }

  function decimalsFor(width) {
    var d = Math.ceil(-Math.log10(width));
    return d > 0 && isFinite(d) ? Math.min(d, 6) : 0;
  }

  // Shared distribution used by both the on-screen histogram and the CSV
  // export, so the two can never disagree. One bin per Step increment (every
  // value shows, no auto-binning jumps); each bin is classified under/in/over
  // by the value it represents (its lower edge).
  function distributionBins(s) {
    if (!s.n) return null;
    var lsl = state.lsl === "" ? null : Number(state.lsl);
    var usl = state.usl === "" ? null : Number(state.usl);
    if (lsl !== null && !isFinite(lsl)) lsl = null;
    if (usl !== null && !isFinite(usl)) usl = null;
    var hasSpec = lsl !== null || usl !== null;

    var width = userStep();
    var dec = decimalsOf(width);
    var start = Number((Math.floor((s.min + 1e-9) / width) * width).toFixed(dec));
    var count = Math.floor((s.max - start) / width + 1e-9) + 1;
    if (count < 1) count = 1;
    if (count > 250) count = 250; // safety cap
    var bins = [];
    for (var i = 0; i < count; i++) {
      bins.push({ lo: Number((start + i * width).toFixed(dec)), count: 0 });
    }
    for (var k = 0; k < state.values.length; k++) {
      var idx = Math.round((state.values[k] - start) / width);
      if (idx < 0) idx = 0;
      if (idx >= count) idx = count - 1;
      bins[idx].count++;
    }
    bins.forEach(function (b) {
      b.cls = !hasSpec ? "in"
        : (lsl !== null && b.lo < lsl) ? "under"
        : (usl !== null && b.lo > usl) ? "over" : "in";
    });
    return { bins: bins, dec: dec, lsl: lsl, usl: usl, hasSpec: hasSpec };
  }

  function renderHistogram(s) {
    var host = els.histogram;
    host.innerHTML = "";
    if (!s.n) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No values yet.";
      host.appendChild(empty);
      els.histLegend.style.display = "none";
      return;
    }

    var d = distributionBins(s);
    var bins = d.bins, dec = d.dec, lsl = d.lsl, usl = d.usl, hasSpec = d.hasSpec;
    els.histLegend.style.display = hasSpec ? "flex" : "none";

    var maxCount = 0;
    bins.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });

    function divider(label) {
      var d = document.createElement("div");
      d.className = "hist-divider";
      var span = document.createElement("span");
      span.textContent = label;
      d.appendChild(span);
      host.appendChild(d);
    }

    var prevClass = null;
    bins.forEach(function (b) {
      var cls = b.cls;
      // Separator lines between under / in / over regions.
      if (hasSpec && prevClass !== null) {
        if (prevClass === "under" && cls !== "under" && lsl !== null) {
          divider("LSL = " + fmt(lsl));
        }
        if (prevClass !== "over" && cls === "over" && usl !== null) {
          divider("USL = " + fmt(usl));
        }
      }
      prevClass = cls;

      var row = document.createElement("div");
      row.className = "hist-row hist-row--" + cls;

      var label = document.createElement("span");
      label.className = "hist-label";
      label.textContent = b.lo.toFixed(dec);

      var track = document.createElement("span");
      track.className = "hist-track";
      var fill = document.createElement("span");
      fill.className = "hist-fill";
      fill.style.width = maxCount ? (b.count / maxCount * 100) + "%" : "0%";
      track.appendChild(fill);

      var cnt = document.createElement("span");
      cnt.className = "hist-count";
      cnt.textContent = b.count;

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(cnt);
      host.appendChild(row);
    });
  }

  function renderSpec(s) {
    var lsl = state.lsl === "" ? null : Number(state.lsl);
    var usl = state.usl === "" ? null : Number(state.usl);
    if (lsl !== null && !isFinite(lsl)) lsl = null;
    if (usl !== null && !isFinite(usl)) usl = null;

    var n = state.values.length;
    var under = 0, over = 0;
    if (n > 0 && (lsl !== null || usl !== null)) {
      for (var i = 0; i < n; i++) {
        var v = state.values[i];
        if (lsl !== null && v < lsl) under++;
        else if (usl !== null && v > usl) over++;
      }
    }
    var inSpec = n - under - over;
    var haveSpec = n > 0 && (lsl !== null || usl !== null);

    function pct(c) { return haveSpec ? (Math.round((c / n) * 1000) / 10) + "%" : "–"; }

    els.pctUnder.textContent = pct(under);
    els.pctIn.textContent = pct(inSpec);
    els.pctInLeg.textContent = pct(inSpec);
    els.pctOver.textContent = pct(over);

    // Donut gauge: under | in | over slices around the ring.
    if (haveSpec) {
      var pu = under / n * 100, pi = inSpec / n * 100;
      var a = pu, b = pu + pi;
      els.specRing.style.background =
        "conic-gradient(var(--under) 0 " + a + "%, var(--in) " + a + "% " + b +
        "%, var(--over) " + b + "% 100%)";
    } else {
      els.specRing.style.background = "conic-gradient(var(--line) 0 100%)";
    }
  }

  function renderAllValues() {
    var lsl = state.lsl === "" ? null : Number(state.lsl);
    var usl = state.usl === "" ? null : Number(state.usl);
    if (lsl !== null && !isFinite(lsl)) lsl = null;
    if (usl !== null && !isFinite(usl)) usl = null;

    els.allValuesList.innerHTML = "";
    if (state.values.length === 0) {
      var empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No values yet. Add some on the Enter tab.";
      els.allValuesList.appendChild(empty);
      return;
    }
    for (var i = 0; i < state.values.length; i++) {
      var v = state.values[i];
      var li = document.createElement("li");
      var status = "";
      var tag = "";
      if (lsl !== null && v < lsl) { status = "is-under"; tag = "UNDER"; }
      else if (usl !== null && v > usl) { status = "is-over"; tag = "OVER"; }
      if (status) li.className = status;

      var left = document.createElement("span");
      left.className = "vidx";
      left.textContent = "Rep " + (i + 1);
      var right = document.createElement("span");
      right.textContent = fmt(v);
      li.appendChild(left);
      if (tag) {
        var t = document.createElement("span");
        t.className = "tag";
        t.textContent = tag;
        right.textContent = fmt(v) + "  ";
        right.appendChild(t);
      }
      li.appendChild(right);
      els.allValuesList.appendChild(li);
    }
  }

  function renderAll() {
    renderEntry();
    renderSummary();
  }

  /* ---------- Actions ---------- */
  function addFromInput() {
    var nums = parseNumbers(els.entryInput.value);
    if (nums.length === 0) { els.entryInput.value = ""; return; }
    for (var i = 0; i < nums.length; i++) state.values.push(nums[i]);
    els.entryInput.value = "";
    save();
    updateStatline();
    els.entryInput.focus();
  }

  /* ---------- Calculator keypad ---------- */
  // Returns the start index of the number currently being typed
  // (everything after the last space/comma/semicolon separator).
  function lastTokenStart(v) {
    var idx = -1, i;
    var seps = [" ", ",", ";", "\n", "\t"];
    for (i = 0; i < seps.length; i++) {
      var p = v.lastIndexOf(seps[i]);
      if (p > idx) idx = p;
    }
    return idx + 1;
  }

  function keypadPress(key, action) {
    var input = els.entryInput;
    var v = input.value;

    if (action === "enter") { addFromInput(); return; }
    if (action === "back") { input.value = v.slice(0, -1); return; }
    if (action === "space") {
      // Queue another number: add a separator if the current token isn't empty.
      if (v !== "" && v.slice(-1) !== " ") input.value = v + " ";
      input.focus();
      return;
    }
    if (action === "sign") {
      var start = lastTokenStart(v);
      var head = v.slice(0, start);
      var tok = v.slice(start);
      tok = tok.charAt(0) === "-" ? tok.slice(1) : "-" + tok;
      input.value = head + tok;
      input.focus();
      return;
    }
    if (key === ".") {
      var s = lastTokenStart(v);
      if (v.slice(s).indexOf(".") !== -1) return; // one decimal per number
      input.value = v + ".";
      input.focus();
      return;
    }
    // digit
    input.value = v + key;
    input.focus();
  }

  function onKeypad(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.action) keypadPress(null, btn.dataset.action);
    else if (btn.dataset.key != null) keypadPress(btn.dataset.key, null);
  }

  function removeAt(index) {
    if (index >= 0 && index < state.values.length) {
      state.values.splice(index, 1);
      save();
      renderAll();
    }
  }

  function undoLast() {
    if (state.values.length) {
      state.values.pop();
      save();
      renderAll();
    }
  }

  function clearAll() {
    if (state.values.length === 0) return;
    if (window.confirm("Clear all " + state.values.length + " replications?")) {
      state.values = [];
      save();
      renderAll();
    }
  }

  // A full, readable report of everything on the Summary page: statistics,
  // specification limits with under/in/over counts + percentages, the
  // distribution, and the raw replications. Laid out in labelled sections
  // with blank-line separators so it's easy to read in any spreadsheet.
  function buildCSV() {
    var s = stats(state.values);
    var d = distributionBins(s);
    var hasSpec = d && d.hasSpec;

    // Wrap any field that might contain a comma so columns never break.
    function esc(v) {
      var str = (v === null || v === undefined) ? "" : String(v);
      return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    }
    function val(x) { return s.n ? fmt(x) : ""; }

    var lines = [];
    lines.push("Specification Recorder — Summary");
    lines.push("Record," + esc(state.recordName.trim()));
    lines.push("");

    // ----- Statistics (the stat cards) -----
    lines.push("Statistics");
    lines.push("Metric,Value");
    lines.push("Replications," + (s.n || 0));
    lines.push("Average," + val(s.avg));
    lines.push("Median," + val(s.median));
    lines.push("Mode," + (s.n ? (s.mode === null ? "none" : fmt(s.mode)) : ""));
    lines.push("Minimum," + val(s.min));
    lines.push("Maximum," + val(s.max));
    lines.push("Range," + val(s.range));
    lines.push("");

    // ----- Specification limits + under/in/over counts and % -----
    var n = s.n || 0;
    var under = 0, over = 0;
    if (hasSpec) {
      for (var i = 0; i < state.values.length; i++) {
        var v = state.values[i];
        if (d.lsl !== null && v < d.lsl) under++;
        else if (d.usl !== null && v > d.usl) over++;
      }
    }
    var inSpec = n - under - over;
    function pct(c) { return (hasSpec && n) ? (Math.round((c / n) * 1000) / 10) + "%" : ""; }

    lines.push("Specification");
    lines.push("Lower limit (LSL)," + (state.lsl === "" ? "not set" : state.lsl));
    lines.push("Upper limit (USL)," + (state.usl === "" ? "not set" : state.usl));
    lines.push("Category,Count,Percent");
    lines.push("Under spec," + under + "," + pct(under));
    lines.push("In spec," + inSpec + "," + pct(inSpec));
    lines.push("Over spec," + over + "," + pct(over));
    lines.push("Total," + n + "," + (hasSpec && n ? "100%" : ""));
    lines.push("");

    // ----- Distribution (one row per Step increment; mirrors the histogram) -----
    lines.push("Distribution");
    lines.push(hasSpec ? "Value,Count,Region" : "Value,Count");
    if (d) {
      d.bins.forEach(function (b) {
        var region = b.cls === "under" ? "Under" : b.cls === "over" ? "Over" : "In spec";
        lines.push(hasSpec ? (b.lo.toFixed(d.dec) + "," + b.count + "," + region)
                           : (b.lo.toFixed(d.dec) + "," + b.count));
      });
    }
    lines.push("");

    // ----- All replications (in entry order) -----
    lines.push("All replications");
    lines.push(hasSpec ? "Replication,Value,Status" : "Replication,Value");
    for (var k = 0; k < state.values.length; k++) {
      var vv = state.values[k];
      var status = "";
      if (hasSpec) {
        status = (d.lsl !== null && vv < d.lsl) ? "Under"
               : (d.usl !== null && vv > d.usl) ? "Over" : "In spec";
      }
      lines.push(hasSpec ? ((k + 1) + "," + fmt(vv) + "," + status)
                         : ((k + 1) + "," + fmt(vv)));
    }

    return lines.join("\n");
  }

  // Desktop fallback: trigger a file download, or copy to clipboard.
  function downloadCSV(csv, filename) {
    try {
      var blob = new Blob([csv], { type: "text/csv" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csv);
        window.alert("Export copied to clipboard.");
      }
    }
  }

  function exportCSV() {
    if (state.values.length === 0) {
      window.alert("Nothing to export yet — add some replications first.");
      return;
    }
    var csv = buildCSV();
    // The record's name drives the file name and the share title, so exports
    // are recognisable (falls back to the spec limits, then a generic label).
    var displayName = state.recordName.trim() || specDisplay() || "Specification Recorder";
    var filename =
      (state.recordName.trim() || specDisplay() || "record_qc")
        .replace(/[^a-z0-9]+/gi, "_").toLowerCase() + ".csv";

    // Prefer the native share sheet on mobile (lets you "Save to Files",
    // mail, message, etc.) — a blob download often fails inside an
    // installed PWA on iOS.
    try {
      var file = new File([csv], filename, { type: "text/csv" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: displayName })
          .catch(function () { /* user cancelled — no-op */ });
        return;
      }
    } catch (e) { /* File/share unsupported — fall through */ }

    if (navigator.share) {
      navigator.share({ title: displayName, text: csv })
        .catch(function () { downloadCSV(csv, filename); });
      return;
    }

    downloadCSV(csv, filename);
  }

  /* ---------- Navigation ---------- */
  function showPage(which) {
    var entry = which === "entry";
    els.pageEntry.classList.toggle("hidden", !entry);
    els.pageSummary.classList.toggle("hidden", entry);
    els.tabEntry.classList.toggle("is-active", entry);
    els.tabSummary.classList.toggle("is-active", !entry);
    if (entry) {
      if (state.mode === "manual") els.entryInput.focus();
    } else {
      renderSummary();
    }
    window.scrollTo(0, 0);
  }

  /* ---------- Wire up events ---------- */
  function init() {
    load();

    els.recordName.value = state.recordName;
    els.lowEntry.value = state.lsl;
    els.highEntry.value = state.usl;
    els.stepInput.value = state.step;
    els.lslInput.value = state.lsl;
    els.uslInput.value = state.usl;

    els.entryForm.addEventListener("submit", function (e) {
      e.preventDefault();
      addFromInput();
    });

    if (els.keypad) els.keypad.addEventListener("click", onKeypad);
    if (els.keypadActions) els.keypadActions.addEventListener("click", onKeypad);

    if (els.valuesList) {
      els.valuesList.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-index]");
        if (btn) removeAt(parseInt(btn.dataset.index, 10));
      });
    }

    els.undoBtn.addEventListener("click", undoLast);
    els.clearBtn.addEventListener("click", clearAll);
    els.exportBtn.addEventListener("click", exportCSV);

    els.modeQuick.addEventListener("click", function () { setMode("quick"); });
    els.modeManual.addEventListener("click", function () { setMode("manual"); });

    els.valueGrid.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-val]");
      if (btn) recordValue(Number(btn.dataset.val), btn);
    });
    els.addLower.addEventListener("click", function () { extendGrid(-1); });
    els.addHigher.addEventListener("click", function () { extendGrid(1); });
    els.lowerLess.addEventListener("click", function () { shrinkGrid(-1); });
    els.higherLess.addEventListener("click", function () { shrinkGrid(1); });

    els.recordName.addEventListener("input", function () {
      state.recordName = els.recordName.value;
      save();
    });

    // Interval between value buttons.
    els.stepInput.addEventListener("input", function () {
      var s = Number(els.stepInput.value.trim());
      state.step = isFinite(s) && s > 0 ? s : 0.1;
      rebuildGrid();
      save();
      renderValueGrid();
    });

    // Lower/Upper limits — same data in both the Enter tab and Summary;
    // editing any one updates the others, the value buttons and the stats.
    function onLimit(which, inputEl) {
      if (which === "lsl") state.lsl = inputEl.value.trim();
      else state.usl = inputEl.value.trim();
      rebuildGrid();
      syncLimitInputs(inputEl);
      save();
      renderValueGrid();
      renderSummary();
    }
    els.lowEntry.addEventListener("input", function () { onLimit("lsl", els.lowEntry); });
    els.highEntry.addEventListener("input", function () { onLimit("usl", els.highEntry); });
    els.lslInput.addEventListener("input", function () { onLimit("lsl", els.lslInput); });
    els.uslInput.addEventListener("input", function () { onLimit("usl", els.uslInput); });

    els.tabEntry.addEventListener("click", function () { showPage("entry"); });
    els.tabSummary.addEventListener("click", function () { showPage("summary"); });

    // Keep the app exactly as tall as the *visible* viewport so Safari / in-app
    // browser chrome can never hide the bottom controls, and re-fill the value
    // grid whenever that height changes.
    function syncViewportHeight() {
      var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      document.documentElement.style.setProperty("--app-h", h + "px");
    }
    function onViewportChange() {
      syncViewportHeight();
      if (state.mode !== "manual") renderValueGrid();
    }
    syncViewportHeight();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onViewportChange);

    // First load: rebuild the value buttons from saved limits.
    rebuildGrid();

    renderAll();
  }

  /* ---------- Service worker (offline / installable) ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* ignore */ });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
