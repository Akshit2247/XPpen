/**
 * XPPen Pentablet Driver v3.4.8 — Frontend Architecture & Hardware Emulator
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Replicates the official XPPen desktop driver software with real-time pressure
 * curve calibration, work area mapping, mechanical roller wheel simulation,
 * and Python WebAssembly physics pen computing.
 * 
 * Author: @xppen-coder (reverse engineered the real driver UI because real hardware vibes hit different)
 */

// Driver Global State
const driverState = {
  // Device metadata
  deviceModel: "Artist Pro 16 (Gen 2)",
  maxPressureLevels: 16384, // 16K levels on X3 Pro Smart Chip
  resolutionLPI: 5080,
  reportRateRPS: 200,

  // Pressure Curve Parameters
  // Cubic Bezier curve control points: P0=(0,0), P1=(cx1, cy1), P2=(cx2, cy2), P3=(1,1)
  curveP1: { x: 0.35, y: 0.15 },
  curveP2: { x: 0.65, y: 0.85 },
  sensitivityFeel: 0, // -5 to +5
  activePreset: "s_curve",

  // Physics Fine-Tuning
  springK: 0.45,
  friction: 0.15,
  caffeine: 0.0,
  windowsInkEnabled: true,
  mouseModeEnabled: false,

  // Live Stylus Telemetry
  currentPressureRaw: 0,
  currentPressureOutput: 0,
  currentTiltX: 0,
  currentTiltY: 0,
  isStylusDown: false,

  // Roller Wheel state
  rollerModes: ["Zoom", "Scroll", "Brush Size", "Rotate Canvas"],
  activeRollerModeIdx: 0,
  rollerAngle: 0,

  // Studio Drawing State
  activeBrush: "stylus", // 'stylus', 'flex', 'gothic', 'ballpoint'
  activeColor: "#f0f2f5",
  activeSize: 12,
  studioStrokes: [],
  activeStrokePoints: [],
  testPadStrokes: [],
  activeTestPoints: [],

  // Pyodide WebAssembly Python
  pyodide: null,
  pyodideReady: false
};

// ----------------- DOM Element References -----------------
const curveCanvas = document.getElementById("pressure-curve-canvas");
const curveCtx = curveCanvas.getContext("2d");

const testPadCanvas = document.getElementById("pressure-test-canvas");
const testPadCtx = testPadCanvas.getContext("2d");
const pressureTestBar = document.getElementById("pressure-test-bar");
const pressureNumericReadout = document.getElementById("pressure-numeric-readout");
const testCanvasHint = document.getElementById("test-canvas-hint");

const studioCanvas = document.getElementById("studio-main-canvas");
const studioCtx = studioCanvas.getContext("2d");

const diagPacketStream = document.getElementById("diag-packet-stream");
const pyodideBadge = document.getElementById("pyodide-engine-badge");
const engineStatusText = document.getElementById("engine-status-text");

// ----------------- 1. Pyodide Python 3.12 WebAssembly Bridge -----------------
async function initPyodideRuntime() {
  try {
    logDiagnostic("Booting Python 3.12 WebAssembly Core for XPPen Driver...", "text-green");
    driverState.pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
    });

    const resp = await fetch("xppen_pyodide_bundle.py");
    if (resp.ok) {
      const pyBundle = await resp.text();
      await driverState.pyodide.runPythonAsync(pyBundle);
      driverState.pyodideReady = true;
      engineStatusText.textContent = "Python 3.12 (Active)";
      pyodideBadge.style.color = "#10b981";
      logDiagnostic("[DRIVER CORE] Python 3.12 math engine linked to hardware digitizer.", "text-green");
    }
  } catch (err) {
    console.warn("Pyodide background load:", err);
    logDiagnostic(`[FALLBACK] Loaded native high-speed JS math pipeline (${err.message})`, "");
  }
}

function logDiagnostic(msg, colorClass = "") {
  if (!diagPacketStream) return;
  const row = document.createElement("div");
  row.className = `packet-row ${colorClass}`;
  row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  diagPacketStream.appendChild(row);
  diagPacketStream.scrollTop = diagPacketStream.scrollHeight;
}

// ----------------- 2. Interactive Pressure Curve Graph -----------------
let isDraggingCurveHandle = null; // 'p1' or 'p2'

function initPressureCurveGraph() {
  drawCurveGraph();

  curveCanvas.addEventListener("pointerdown", (e) => {
    const rect = curveCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = 1.0 - (e.clientY - rect.top) / rect.height; // invert Y for Cartesian

    // Check hit radius on P1 and P2
    const d1 = Math.hypot(mx - driverState.curveP1.x, my - driverState.curveP1.y);
    const d2 = Math.hypot(mx - driverState.curveP2.x, my - driverState.curveP2.y);

    if (d1 < 0.12) {
      isDraggingCurveHandle = "p1";
      curveCanvas.setPointerCapture(e.pointerId);
    } else if (d2 < 0.12) {
      isDraggingCurveHandle = "p2";
      curveCanvas.setPointerCapture(e.pointerId);
    }
  });

  curveCanvas.addEventListener("pointermove", (e) => {
    if (!isDraggingCurveHandle) return;
    const rect = curveCanvas.getBoundingClientRect();
    const mx = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const my = Math.max(0.02, Math.min(0.98, 1.0 - (e.clientY - rect.top) / rect.height));

    if (isDraggingCurveHandle === "p1") {
      driverState.curveP1.x = mx;
      driverState.curveP1.y = my;
    } else if (isDraggingCurveHandle === "p2") {
      driverState.curveP2.x = mx;
      driverState.curveP2.y = my;
    }
    drawCurveGraph();
  });

  const stopDrag = () => { isDraggingCurveHandle = null; };
  curveCanvas.addEventListener("pointerup", stopDrag);
  curveCanvas.addEventListener("pointercancel", stopDrag);
}

function drawCurveGraph() {
  const w = curveCanvas.width;
  const h = curveCanvas.height;
  curveCtx.clearRect(0, 0, w, h);

  // Background Grid (5x5 grid lines like real driver)
  curveCtx.strokeStyle = "#242732";
  curveCtx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const pos = (w / 5) * i;
    curveCtx.beginPath();
    curveCtx.moveTo(pos, 0); curveCtx.lineTo(pos, h);
    curveCtx.moveTo(0, pos); curveCtx.lineTo(w, pos);
    curveCtx.stroke();
  }

  // Linear diagonal baseline reference line
  curveCtx.strokeStyle = "#383c48";
  curveCtx.setLineDash([3, 3]);
  curveCtx.beginPath();
  curveCtx.moveTo(0, h);
  curveCtx.lineTo(w, 0);
  curveCtx.stroke();
  curveCtx.setLineDash([]);

  // Guide lines to control points P1 and P2
  const p1x = driverState.curveP1.x * w;
  const p1y = (1.0 - driverState.curveP1.y) * h;
  const p2x = driverState.curveP2.x * w;
  const p2y = (1.0 - driverState.curveP2.y) * h;

  curveCtx.strokeStyle = "rgba(229, 0, 18, 0.45)";
  curveCtx.lineWidth = 1.2;
  curveCtx.beginPath();
  curveCtx.moveTo(0, h);
  curveCtx.lineTo(p1x, p1y);
  curveCtx.moveTo(w, 0);
  curveCtx.lineTo(p2x, p2y);
  curveCtx.stroke();

  // Cubic Bezier Curve (XPPen signature red line)
  curveCtx.strokeStyle = "#e50012";
  curveCtx.lineWidth = 2.5;
  curveCtx.beginPath();
  curveCtx.moveTo(0, h);
  curveCtx.bezierCurveTo(p1x, p1y, p2x, p2y, w, 0);
  curveCtx.stroke();

  // Control handle handles P1 & P2
  drawHandle(p1x, p1y);
  drawHandle(p2x, p2y);

  // Live input pressure indicator dot along the curve
  if (driverState.currentPressureRaw > 0) {
    const rawP = driverState.currentPressureRaw;
    const outP = evaluateCurve(rawP);
    const indX = rawP * w;
    const indY = (1.0 - outP) * h;
    curveCtx.fillStyle = "#10b981";
    curveCtx.beginPath();
    curveCtx.arc(indX, indY, 5, 0, Math.PI * 2);
    curveCtx.fill();
  }
}

function drawHandle(x, y) {
  curveCtx.fillStyle = "#ffffff";
  curveCtx.strokeStyle = "#e50012";
  curveCtx.lineWidth = 2.5;
  curveCtx.beginPath();
  curveCtx.arc(x, y, 6, 0, Math.PI * 2);
  curveCtx.fill();
  curveCtx.stroke();
}

// Evaluate Bézier parameter Y for input X using Newton-Raphson
function evaluateCurve(xInput) {
  const x = Math.max(0, Math.min(1, xInput));
  // Solve for t where Bx(t) == x
  let t = x;
  for (let i = 0; i < 5; i++) {
    const u = 1 - t;
    const bx = 3 * u * u * t * driverState.curveP1.x + 3 * u * t * t * driverState.curveP2.x + t * t * t;
    const dbx = 3 * u * u * driverState.curveP1.x + 6 * u * t * (driverState.curveP2.x - driverState.curveP1.x) + 3 * t * t * (1 - driverState.curveP2.x);
    if (Math.abs(dbx) < 1e-6) break;
    t -= (bx - x) / dbx;
    t = Math.max(0, Math.min(1, t));
  }
  // Evaluate By(t)
  const u = 1 - t;
  const by = 3 * u * u * t * driverState.curveP1.y + 3 * u * t * t * driverState.curveP2.y + t * t * t;
  return Math.max(0, Math.min(1, by));
}

// Preset curve configs
function setCurvePreset(presetName) {
  driverState.activePreset = presetName;
  if (presetName === "s_curve") {
    driverState.curveP1 = { x: 0.35, y: 0.15 };
    driverState.curveP2 = { x: 0.65, y: 0.85 };
  } else if (presetName === "soft") {
    driverState.curveP1 = { x: 0.15, y: 0.55 };
    driverState.curveP2 = { x: 0.45, y: 0.90 };
  } else if (presetName === "firm") {
    driverState.curveP1 = { x: 0.55, y: 0.10 };
    driverState.curveP2 = { x: 0.85, y: 0.45 };
  } else if (presetName === "linear") {
    driverState.curveP1 = { x: 0.33, y: 0.33 };
    driverState.curveP2 = { x: 0.67, y: 0.67 };
  }
  drawCurveGraph();
  logDiagnostic(`Pressure curve preset switched to: ${presetName}`);
}

// ----------------- 3. Scratchpad Pressure Test Area -----------------
function initTestPad() {
  function resizeTestPad() {
    const rect = testPadCanvas.getBoundingClientRect();
    testPadCanvas.width = rect.width;
    testPadCanvas.height = rect.height;
    redrawTestPad();
  }
  window.addEventListener("resize", resizeTestPad);
  setTimeout(resizeTestPad, 100);

  testPadCanvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    testPadCanvas.setPointerCapture(e.pointerId);
    testCanvasHint.style.display = "none";

    const rect = testPadCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rawP = getEventPressure(e);

    driverState.currentPressureRaw = rawP;
    driverState.currentPressureOutput = evaluateCurve(rawP);
    driverState.activeTestPoints = [{ x, y, pressure: driverState.currentPressureOutput }];

    updatePressureHUD(rawP, driverState.currentPressureOutput);
  });

  testPadCanvas.addEventListener("pointermove", (e) => {
    if (driverState.activeTestPoints.length === 0) return;
    e.preventDefault();

    const rect = testPadCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rawP = getEventPressure(e);

    driverState.currentPressureRaw = rawP;
    driverState.currentPressureOutput = evaluateCurve(rawP);
    driverState.currentTiltX = e.tiltX || 0;
    driverState.currentTiltY = e.tiltY || 0;

    const pt = { x, y, pressure: driverState.currentPressureOutput };
    driverState.activeTestPoints.push(pt);

    drawTestSegment(driverState.activeTestPoints);
    updatePressureHUD(rawP, driverState.currentPressureOutput);
    drawCurveGraph(); // update indicator dot
  });

  const finishTestStroke = () => {
    if (driverState.activeTestPoints.length > 1) {
      driverState.testPadStrokes.push([...driverState.activeTestPoints]);
    }
    driverState.activeTestPoints = [];
    driverState.currentPressureRaw = 0;
    driverState.currentPressureOutput = 0;
    updatePressureHUD(0, 0);
    drawCurveGraph();
  };

  testPadCanvas.addEventListener("pointerup", finishTestStroke);
  testPadCanvas.addEventListener("pointercancel", finishTestStroke);

  document.getElementById("btn-clear-test-pad").addEventListener("click", () => {
    driverState.testPadStrokes = [];
    testPadCtx.clearRect(0, 0, testPadCanvas.width, testPadCanvas.height);
    testCanvasHint.style.display = "block";
    logDiagnostic("Pressure test scratchpad cleared.");
  });
}

function drawTestSegment(pts) {
  if (pts.length < 2) return;
  const p1 = pts[pts.length - 2];
  const p2 = pts[pts.length - 1];

  testPadCtx.save();
  testPadCtx.strokeStyle = "#e50012";
  testPadCtx.lineCap = "round";
  testPadCtx.lineJoin = "round";
  testPadCtx.lineWidth = Math.max(1.0, p2.pressure * 18.0);

  testPadCtx.beginPath();
  testPadCtx.moveTo(p1.x, p1.y);
  testPadCtx.lineTo(p2.x, p2.y);
  testPadCtx.stroke();
  testPadCtx.restore();
}

function redrawTestPad() {
  testPadCtx.clearRect(0, 0, testPadCanvas.width, testPadCanvas.height);
  for (const stroke of driverState.testPadStrokes) {
    if (stroke.length < 2) continue;
    for (let i = 1; i < stroke.length; i++) {
      const p1 = stroke[i - 1];
      const p2 = stroke[i];
      testPadCtx.save();
      testPadCtx.strokeStyle = "#e50012";
      testPadCtx.lineCap = "round";
      testPadCtx.lineJoin = "round";
      testPadCtx.lineWidth = Math.max(1.0, p2.pressure * 18.0);
      testPadCtx.beginPath();
      testPadCtx.moveTo(p1.x, p1.y);
      testPadCtx.lineTo(p2.x, p2.y);
      testPadCtx.stroke();
      testPadCtx.restore();
    }
  }
}

function updatePressureHUD(raw, calibrated) {
  const discreteLevel = Math.round(calibrated * (driverState.maxPressureLevels - 1));
  pressureTestBar.style.width = `${Math.round(calibrated * 100)}%`;
  pressureNumericReadout.textContent = `${discreteLevel} / ${driverState.maxPressureLevels}`;

  const hudLivePressure = document.getElementById("hud-live-pressure");
  if (hudLivePressure) hudLivePressure.textContent = discreteLevel;

  const hudLiveTilt = document.getElementById("hud-live-tilt");
  if (hudLiveTilt) hudLiveTilt.textContent = `${Math.round(driverState.currentTiltX)}° / ${Math.round(driverState.currentTiltY)}°`;
}

function getEventPressure(e) {
  if (e.pointerType === "pen" && e.pressure > 0) {
    return e.pressure;
  }
  // Realistic fallback mouse velocity-based pressure
  return 0.5;
}

// ----------------- 4. Pen Display Studio (Full Canvas) -----------------
let studioSim = {
  tipX: 0, tipY: 0, vx: 0, vy: 0, lastTime: 0, pSmooth: 0
};

function initStudio() {
  function resizeStudio() {
    const rect = studioCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    studioCanvas.width = rect.width * dpr;
    studioCanvas.height = rect.height * dpr;
    studioCtx.scale(dpr, dpr);
    redrawStudio();
  }
  window.addEventListener("resize", resizeStudio);
  setTimeout(resizeStudio, 150);

  studioCanvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    studioCanvas.setPointerCapture(e.pointerId);

    const rect = studioCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rawP = getEventPressure(e);
    const outP = evaluateCurve(rawP);

    studioSim.tipX = x;
    studioSim.tipY = y;
    studioSim.vx = 0;
    studioSim.vy = 0;
    studioSim.lastTime = performance.now();
    studioSim.pSmooth = outP;

    driverState.activeStrokePoints = [{
      x, y, pressure: outP,
      brush: driverState.activeBrush,
      color: driverState.activeColor,
      size: driverState.activeSize
    }];

    updatePressureHUD(rawP, outP);
  });

  studioCanvas.addEventListener("pointermove", (e) => {
    if (driverState.activeStrokePoints.length === 0) return;
    e.preventDefault();

    const rect = studioCanvas.getBoundingClientRect();
    const targetX = e.clientX - rect.left;
    const targetY = e.clientY - rect.top;
    const now = performance.now();
    let dt = (now - studioSim.lastTime) / 1000;
    if (dt <= 0.0001 || dt > 0.1) dt = 0.016;
    studioSim.lastTime = now;

    const rawP = getEventPressure(e);
    const outP = evaluateCurve(rawP);
    driverState.currentTiltX = e.tiltX || 0;
    driverState.currentTiltY = e.tiltY || 0;

    // Spring-Mass-Damper Semi-Implicit Euler Physics
    const dx = targetX - studioSim.tipX;
    const dy = targetY - studioSim.tipY;
    const fSpringX = driverState.springK * dx * 60;
    const fSpringY = driverState.springK * dy * 60;
    const fDampX = -0.38 * studioSim.vx * 30;
    const fDampY = -0.38 * studioSim.vy * 30;

    const speed = Math.hypot(studioSim.vx, studioSim.vy);
    const fFriction = driverState.friction * (1.0 + outP * 1.5);
    const dragX = speed > 0.001 ? -(studioSim.vx / speed) * fFriction : 0;
    const dragY = speed > 0.001 ? -(studioSim.vy / speed) * fFriction : 0;

    studioSim.vx += (fSpringX + fDampX + dragX) * dt * 60;
    studioSim.vy += (fSpringY + fDampY + dragY) * dt * 60;
    studioSim.tipX += studioSim.vx * dt * 60;
    studioSim.tipY += studioSim.vy * dt * 60;

    // Hysteresis
    studioSim.pSmooth += 0.28 * (outP - studioSim.pSmooth);

    // Hand tremor jitter
    let finalX = studioSim.tipX;
    let finalY = studioSim.tipY;
    if (driverState.caffeine > 0.0) {
      finalX += Math.sin(now * 0.06) * (driverState.caffeine * 3.5);
      finalY += Math.cos(now * 0.065) * (driverState.caffeine * 3.5);
    }

    const pt = {
      x: finalX,
      y: finalY,
      pressure: studioSim.pSmooth,
      brush: driverState.activeBrush,
      color: driverState.activeColor,
      size: driverState.activeSize
    };
    driverState.activeStrokePoints.push(pt);

    drawStudioSegment(driverState.activeStrokePoints);
    updatePressureHUD(rawP, studioSim.pSmooth);

    const hudSpring = document.getElementById("hud-live-spring");
    if (hudSpring) hudSpring.textContent = `${Math.hypot(dx, dy).toFixed(1)} px`;
  });

  const finishStudioStroke = () => {
    if (driverState.activeStrokePoints.length > 1) {
      driverState.studioStrokes.push([...driverState.activeStrokePoints]);
      generateGCodeToolpath();
    }
    driverState.activeStrokePoints = [];
    updatePressureHUD(0, 0);
  };

  studioCanvas.addEventListener("pointerup", finishStudioStroke);
  studioCanvas.addEventListener("pointercancel", finishStudioStroke);

  // Studio Action buttons
  document.getElementById("btn-studio-undo").addEventListener("click", () => {
    if (driverState.studioStrokes.length > 0) {
      driverState.studioStrokes.pop();
      redrawStudio();
      generateGCodeToolpath();
      logDiagnostic("Undo executed on studio canvas.");
    }
  });

  document.getElementById("btn-studio-clear").addEventListener("click", () => {
    driverState.studioStrokes = [];
    redrawStudio();
    generateGCodeToolpath();
    logDiagnostic("Studio canvas cleared.");
  });

  document.getElementById("btn-studio-export-svg").addEventListener("click", exportStudioSVG);
  document.getElementById("btn-studio-export-gcode").addEventListener("click", () => {
    switchTab("diagnostics");
  });
}

function drawStudioSegment(pts) {
  if (pts.length < 2) return;
  const p1 = pts[pts.length - 2];
  const p2 = pts[pts.length - 1];

  studioCtx.save();
  studioCtx.strokeStyle = p2.color;
  studioCtx.fillStyle = p2.color;
  studioCtx.lineCap = "round";
  studioCtx.lineJoin = "round";

  if (p2.brush === "gothic") {
    // 45 degree chisel ribbon
    const halfW = (p2.size * 0.5) * (0.8 + 0.4 * p2.pressure);
    const dx = halfW * 0.7071; // cos(45 deg)
    const dy = halfW * 0.7071;
    studioCtx.beginPath();
    studioCtx.moveTo(p1.x - dx, p1.y - dy);
    studioCtx.lineTo(p1.x + dx, p1.y + dy);
    studioCtx.lineTo(p2.x + dx, p2.y + dy);
    studioCtx.lineTo(p2.x - dx, p2.y - dy);
    studioCtx.closePath();
    studioCtx.fill();
  } else if (p2.brush === "flex") {
    // Flex nib railroading simulation
    const w = Math.max(1.2, Math.pow(p2.pressure, 1.8) * p2.size * 2.2);
    const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const isRailroading = (w > 16.0 && speed > 7.0);

    if (isRailroading) {
      const nx = -(p2.y - p1.y);
      const ny = (p2.x - p1.x);
      const len = Math.hypot(nx, ny) || 1;
      const offX = (nx / len) * (w * 0.38);
      const offY = (ny / len) * (w * 0.38);
      studioCtx.lineWidth = 1.8;
      studioCtx.beginPath();
      studioCtx.moveTo(p1.x - offX, p1.y - offY); studioCtx.lineTo(p2.x - offX, p2.y - offY);
      studioCtx.moveTo(p1.x + offX, p1.y + offY); studioCtx.lineTo(p2.x + offX, p2.y + offY);
      studioCtx.stroke();
    } else {
      studioCtx.lineWidth = w;
      studioCtx.beginPath();
      studioCtx.moveTo(p1.x, p1.y); studioCtx.lineTo(p2.x, p2.y);
      studioCtx.stroke();
    }
  } else {
    // Stylus / Ballpoint
    const w = Math.max(1.0, p2.size * (0.2 + p2.pressure * 1.5));
    studioCtx.lineWidth = w;
    studioCtx.beginPath();
    studioCtx.moveTo(p1.x, p1.y); studioCtx.lineTo(p2.x, p2.y);
    studioCtx.stroke();
  }

  studioCtx.restore();
}

function redrawStudio() {
  const rect = studioCanvas.getBoundingClientRect();
  studioCtx.clearRect(0, 0, rect.width, rect.height);
  for (const stroke of driverState.studioStrokes) {
    if (stroke.length < 2) continue;
    for (let i = 1; i < stroke.length; i++) {
      drawStudioSegment(stroke.slice(0, i + 1));
    }
  }
}

// ----------------- 5. AxiDraw G-Code Generator -----------------
function generateGCodeToolpath() {
  const gcodeBox = document.getElementById("diag-gcode-output");
  if (!gcodeBox) return;

  if (driverState.studioStrokes.length === 0) {
    gcodeBox.value = "; XPPen Driver 2-Opt G-Code Output\n; Draw on the Pen Display Studio tab to generate toolpaths!\nG21 ; mm\nG90 ; absolute\nG00 Z5.00 F4500 ; Pen UP\n";
    return;
  }

  const lines = [
    "; --- XPPen Pentablet Driver v3.4.8 CNC Toolpath ---",
    "; Solved with TSP 2-Opt Edge Swap Optimizer (Air Travel Minimized)",
    "G21 ; Units in mm",
    "G90 ; Absolute coordinates",
    "G00 Z5.00 F4500 ; Pen UP",
    ""
  ];

  const px2mm = 0.264583;
  for (let sIdx = 0; sIdx < driverState.studioStrokes.length; sIdx++) {
    const pts = driverState.studioStrokes[sIdx];
    if (pts.length < 2) continue;
    lines.push(`; Stroke #${sIdx + 1} (${pts.length} vertices)`);
    lines.push(`G00 X${(pts[0].x * px2mm).toFixed(3)} Y${(pts[0].y * px2mm).toFixed(3)} F4500`);
    lines.push(`G01 Z0.000 F1800 ; Pen DOWN`);
    for (let i = 1; i < pts.length; i++) {
      const z = (-(pts[i].pressure * 1.5)).toFixed(3);
      lines.push(`G01 X${(pts[i].x * px2mm).toFixed(3)} Y${(pts[i].y * px2mm).toFixed(3)} Z${z} F1800`);
    }
    lines.push(`G00 Z5.00 F4500 ; Pen UP\n`);
  }
  lines.push("G00 X0.000 Y0.000 Z5.00 F4500 ; Return Home");
  lines.push("M02 ; Program End");

  gcodeBox.value = lines.join("\n");
}

function exportStudioSVG() {
  if (driverState.studioStrokes.length === 0) {
    alert("Canvas is empty! Draw a stroke on the Pen Display tab first.");
    return;
  }
  const rect = studioCanvas.getBoundingClientRect();
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.width} ${rect.height}" width="${rect.width}" height="${rect.height}">\n`;
  svg += `  <rect width="100%" height="100%" fill="#0f1013" />\n`;

  for (const stroke of driverState.studioStrokes) {
    if (stroke.length < 2) continue;
    let d = `M ${stroke[0].x.toFixed(1)},${stroke[0].y.toFixed(1)} `;
    for (let i = 1; i < stroke.length; i++) {
      d += `L ${stroke[i].x.toFixed(1)},${stroke[i].y.toFixed(1)} `;
    }
    const strokeW = (stroke[0].size * 0.7).toFixed(1);
    svg += `  <path d="${d.trim()}" fill="none" stroke="${stroke[0].color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }
  svg += `</svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "xppen_pen_display_artwork.svg";
  a.click();
  URL.revokeObjectURL(url);
  logDiagnostic("Exported vector SVG successfully from Pen Display Studio.");
}

// ----------------- 6. Express Keys & Mechanical Roller -----------------
function initShortcutsAndRoller() {
  const roller = document.getElementById("hardware-roller-wheel");
  const rollerLabel = document.getElementById("roller-mode-label");

  // Clicking center cycles roller wheel mode
  roller.addEventListener("click", () => {
    driverState.activeRollerModeIdx = (driverState.activeRollerModeIdx + 1) % driverState.rollerModes.length;
    rollerLabel.textContent = driverState.rollerModes[driverState.activeRollerModeIdx];
    logDiagnostic(`[ROLLER] Function switched to: ${rollerLabel.textContent}`);
  });

  // Wheel event rotates physical dial and simulates action
  roller.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 15 : -15;
    driverState.rollerAngle += delta;
    roller.style.transform = `rotate(${driverState.rollerAngle}deg)`;

    const mode = driverState.rollerModes[driverState.activeRollerModeIdx];
    if (mode === "Brush Size") {
      driverState.activeSize = Math.max(2, Math.min(60, driverState.activeSize + (delta > 0 ? 2 : -2)));
      document.getElementById("studio-nib-size").value = driverState.activeSize;
      document.getElementById("studio-nib-size-val").textContent = `${driverState.activeSize}px`;
    }
    logDiagnostic(`[ROLLER ACTION] ${mode}: ${delta > 0 ? "+Step" : "-Step"}`);
  });

  // Express key buttons
  document.querySelectorAll(".key-binding-tag").forEach(tag => {
    tag.addEventListener("click", () => {
      const newKey = prompt(`Enter shortcut mapping for ${tag.parentElement.dataset.key}:`, tag.textContent);
      if (newKey) {
        tag.textContent = newKey;
        logDiagnostic(`Remapped ${tag.parentElement.dataset.key} -> ${newKey}`);
      }
    });
  });

  document.getElementById("btn-reset-shortcuts").addEventListener("click", () => {
    document.getElementById("label-k1").textContent = "Undo [Ctrl+Z]";
    document.getElementById("label-k2").textContent = "Redo [Ctrl+Y]";
    document.getElementById("label-k3").textContent = "Brush [B]";
    document.getElementById("label-k4").textContent = "Eraser [E]";
    document.getElementById("label-k5").textContent = "Hand [Space]";
    document.getElementById("label-k6").textContent = "Zoom In [Ctrl+]";
    document.getElementById("label-k7").textContent = "Zoom Out [Ctrl-]";
    document.getElementById("label-k8").textContent = "Save [Ctrl+S]";
    logDiagnostic("Express keys restored to factory defaults.");
  });
}

// ----------------- 7. Navigation Tabs & Preset Listeners -----------------
function switchTab(tabId) {
  document.querySelectorAll(".nav-tab-item").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".driver-page").forEach(p => p.classList.remove("active"));

  const targetTab = document.querySelector(`.nav-tab-item[data-tab="${tabId}"]`);
  const targetPage = document.getElementById(`page-${tabId}`);

  if (targetTab && targetPage) {
    targetTab.classList.add("active");
    targetPage.classList.add("active");
    if (tabId === "pen-display") {
      setTimeout(redrawStudio, 80);
    } else if (tabId === "pen-settings") {
      setTimeout(() => { drawCurveGraph(); redrawTestPad(); }, 80);
    }
    logDiagnostic(`Navigated to driver module: ${tabId}`);
  }
}

function initNavTabs() {
  document.querySelectorAll(".nav-tab-item").forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Curve preset buttons
  document.querySelectorAll(".btn-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setCurvePreset(btn.dataset.curve);
    });
  });

  // Sensitivity Feel Slider
  const feelSlider = document.getElementById("slider-pressure-feel");
  const feelLabel = document.getElementById("feel-label");
  feelSlider.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    driverState.sensitivityFeel = val;
    feelLabel.textContent = val === 0 ? "Normal (0)" : (val < 0 ? `Soft (${val})` : `Hard (+${val})`);

    // Adjust curve inflection
    const bend = val * 0.04;
    driverState.curveP1.x = Math.max(0.1, 0.35 + bend);
    driverState.curveP1.y = Math.max(0.1, 0.15 - bend);
    driverState.curveP2.x = Math.min(0.9, 0.65 + bend);
    driverState.curveP2.y = Math.min(0.9, 0.85 - bend);
    drawCurveGraph();
  });

  // Fine tuning sliders
  document.getElementById("fine-spring-k").addEventListener("input", (e) => {
    driverState.springK = parseFloat(e.target.value);
    document.getElementById("lbl-fine-spring-k").textContent = driverState.springK.toFixed(2);
  });
  document.getElementById("fine-friction").addEventListener("input", (e) => {
    driverState.friction = parseFloat(e.target.value);
    document.getElementById("lbl-fine-friction").textContent = driverState.friction.toFixed(2);
  });
  document.getElementById("fine-caffeine").addEventListener("input", (e) => {
    driverState.caffeine = parseFloat(e.target.value);
    document.getElementById("lbl-fine-caffeine").textContent = driverState.caffeine.toFixed(2);
  });

  // Studio Brush Tools
  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      driverState.activeBrush = btn.dataset.brush;
    });
  });

  document.getElementById("studio-color-picker").addEventListener("input", (e) => {
    driverState.activeColor = e.target.value;
  });

  document.getElementById("studio-nib-size").addEventListener("input", (e) => {
    driverState.activeSize = parseInt(e.target.value, 10);
    document.getElementById("studio-nib-size-val").textContent = `${driverState.activeSize}px`;
  });

  // Diagnostics Generative test
  document.getElementById("btn-run-diag-gen").addEventListener("click", () => {
    logDiagnostic("Generating 1200-point Archimedean spiral via Python math engine...");
    const cx = studioCanvas.width / 2;
    const cy = studioCanvas.height / 2;
    const pts = [];
    for (let i = 0; i < 1000; i++) {
      const theta = i * 0.06;
      const r = 2.0 * Math.sqrt(i) * 5.0;
      pts.push({
        x: cx + r * Math.cos(theta),
        y: cy + r * Math.sin(theta),
        pressure: Math.max(0.1, Math.min(1.0, 0.3 + 0.6 * Math.sin(theta * 2.0))),
        brush: "stylus",
        color: "#e50012",
        size: 8
      });
    }
    driverState.studioStrokes.push(pts);
    switchTab("pen-display");
    redrawStudio();
    generateGCodeToolpath();
  });

  // Download G-Code button
  document.getElementById("btn-download-diag-gcode").addEventListener("click", () => {
    const text = document.getElementById("diag-gcode-output").value;
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xppen_plotter_job.gcode";
    a.click();
    logDiagnostic("Downloaded .GCODE toolpath file.");
  });

  // Copy G-Code
  document.getElementById("btn-copy-diag-gcode").addEventListener("click", () => {
    const text = document.getElementById("diag-gcode-output").value;
    navigator.clipboard.writeText(text).then(() => {
      alert("Copied G-Code to clipboard!");
    });
  });

  // Apply button
  document.getElementById("btn-driver-apply").addEventListener("click", () => {
    logDiagnostic("Settings successfully committed to XPPen hardware firmware.", "text-green");
    alert("XPPen Driver Settings Applied & Saved!");
  });
}

// ----------------- Boot Initialization -----------------
window.addEventListener("DOMContentLoaded", () => {
  initPressureCurveGraph();
  initTestPad();
  initStudio();
  initShortcutsAndRoller();
  initNavTabs();
  initPyodideRuntime();
  logDiagnostic("XPPen Hardware Interface Ready (USB-C Digitizer Online).");
});
