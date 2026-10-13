/**
 * XPpen Studio — Frontend Controller & WebAssembly Python Bridge
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Bridges W3C Pointer Events (XP-Pen styluses) directly with Pyodide Python 3.12.
 * 
 * Author: @xppen-coder (written with excessive caffeine and genuine passion for smooth strokes)
 */

// State container
const state = {
  pyodide: null,
  pyodideReady: false,
  isDrawing: false,
  currentBrush: 'xppen_stylus', // 'xppen_stylus', 'flex_nib', 'broad_nib', 'ballpoint'
  currentColor: '#00f2fe',
  nibSize: 12,
  reservoir: 1000,
  maxReservoir: 1000,
  audioEnabled: false,
  
  // Physics parameters
  springK: 0.45,
  dampingC: 0.38,
  friction: 0.15,
  bezierEps: 3.0,
  pressureCurve: 's_curve',
  caffeine: 0.0,

  // Current stroke tracking
  rawStrokePoints: [],
  completedStrokes: [], // array of stroke objects for undo and gcode
  redoStack: [],

  // Live spring-damper state
  tipX: 0,
  tipY: 0,
  tipVx: 0,
  tipVy: 0,
  lastTimestamp: 0,
  smoothPressure: 0,

  // Mouse fallback
  lastMouseX: 0,
  lastMouseY: 0,
  lastMouseTime: 0
};

// DOM References
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const pyodidePill = document.getElementById('pyodide-pill');
const pyodideStatusText = document.getElementById('pyodide-status-text');
const hardwareStatusText = document.getElementById('hardware-status-text');
const hudPressureVal = document.getElementById('hud-pressure-val');
const gaugePressureFill = document.getElementById('gauge-pressure-fill');
const radarPuck = document.getElementById('radar-puck');
const hudTiltX = document.getElementById('hud-tilt-x');
const hudTiltY = document.getElementById('hud-tilt-y');
const hudSpeed = document.getElementById('hud-speed');
const hudDrag = document.getElementById('hud-drag');
const hudBezierCount = document.getElementById('hud-bezier-count');
const reservoirFill = document.getElementById('reservoir-fill');
const reservoirLabel = document.getElementById('reservoir-label');
const miniTerminal = document.getElementById('mini-terminal');

// Audio Context for ASMR paper scratching
let audioCtx = null;
let noiseNode = null;
let noiseGain = null;
let noiseFilter = null;

function initAudio() {
  if (audioCtx) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    
    // Create 2-second pink noise buffer
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;
    }

    noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;

    noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 1.2;

    noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.0;

    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseNode.start();
  } catch (err) {
    console.warn("Audio Context init blocked until user interaction:", err);
  }
}

function updateAudio(speed, pressure) {
  if (!state.audioEnabled || !noiseGain) return;
  // Volume proportional to velocity * pressure
  const targetGain = Math.min(0.28, (speed * 0.04 + 0.01) * pressure * 0.4);
  noiseGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.04);
  // Frequency rises slightly with velocity
  if (noiseFilter) {
    noiseFilter.frequency.setTargetAtTime(1400 + Math.min(3000, speed * 250), audioCtx.currentTime, 0.05);
  }
}

function stopAudio() {
  if (noiseGain && audioCtx) {
    noiseGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.06);
  }
}

// Log message to mini-terminal in UI
function logTerminal(msg, type = 'text-cyan') {
  if (!miniTerminal) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`;
  miniTerminal.appendChild(line);
  miniTerminal.scrollTop = miniTerminal.scrollHeight;
}

// ----------------- Resize Canvas (High-DPI Retina Support) -----------------
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  redrawAllStrokes();
}

window.addEventListener('resize', resizeCanvas);

// ----------------- Load Pyodide (Python in WebAssembly) -----------------
async function initPyodideEngine() {
  try {
    logTerminal("Booting WebAssembly Python 3.12...", "text-purple");
    state.pyodide = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
    });

    // Fetch our python bundle
    const bundleResp = await fetch("xppen_pyodide_bundle.py");
    if (bundleResp.ok) {
      const pythonCode = await bundleResp.text();
      await state.pyodide.runPythonAsync(pythonCode);
      state.pyodideReady = true;
      pyodidePill.style.color = "#10b981";
      pyodidePill.style.borderColor = "rgba(16, 185, 129, 0.4)";
      pyodideStatusText.textContent = "Python 3.12 Active (WASM)";
      logTerminal("Python 3.12 Engine online! Ready to compute.", "text-green");
    } else {
      throw new Error("Could not fetch xppen_pyodide_bundle.py");
    }
  } catch (err) {
    console.warn("Pyodide remote load notice:", err);
    state.pyodideReady = false;
    pyodideStatusText.textContent = "Python WASM Fallback Ready";
    logTerminal("Loaded native JS mathematical fallback engine", "text-muted");
  }
}

// ----------------- Pressure Curve Calibrator -----------------
function calibratePressure(rawP, curveType) {
  let p = Math.max(0, Math.min(1, rawP));
  // 8192 discrete hardware levels
  p = Math.round(p * 8191) / 8191;

  if (curveType === 'linear') return p;
  if (curveType === 'soft') return Math.pow(p, 0.55);
  if (curveType === 'firm') return Math.pow(p, 1.8);
  if (curveType === 's_curve') {
    const k = 7.0;
    const x0 = 0.45;
    const sig = 1.0 / (1.0 + Math.exp(-k * (p - x0)));
    const sig0 = 1.0 / (1.0 + Math.exp(-k * (0.0 - x0)));
    const sig1 = 1.0 / (1.0 + Math.exp(-k * (1.0 - x0)));
    return Math.max(0, Math.min(1, (sig - sig0) / (sig1 - sig0)));
  }
  return p;
}

// ----------------- Pointer Events Handling -----------------
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  if (state.audioEnabled) initAudio();

  // Detect pointer type
  if (e.pointerType === 'pen') {
    hardwareStatusText.textContent = 'XP-PEN STYLUS LINKED (8192)';
  } else {
    hardwareStatusText.textContent = 'SIMULATED DIGITIZER (MOUSE)';
  }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  let pressure = e.pressure;
  if (e.pointerType !== 'pen' || pressure === 0 || pressure === 0.5) {
    pressure = 0.45; // sensible default for mouse click
  }

  state.isDrawing = true;
  state.tipX = x;
  state.tipY = y;
  state.tipVx = 0;
  state.tipVy = 0;
  state.lastTimestamp = e.timeStamp || performance.now();
  state.smoothPressure = calibratePressure(pressure, state.pressureCurve);
  state.rawStrokePoints = [{
    x, y,
    pressure: state.smoothPressure,
    tiltX: e.tiltX || 0,
    tiltY: e.tiltY || 0,
    timestamp: state.lastTimestamp
  }];

  updateHUD(state.smoothPressure, e.tiltX || 0, e.tiltY || 0, 0, 0);
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.isDrawing) {
    // Just hover telemetry
    if (e.tiltX || e.tiltY) {
      updateRadarPuck(e.tiltX, e.tiltY);
    }
    return;
  }
  e.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const targetX = e.clientX - rect.left;
  const targetY = e.clientY - rect.top;
  const now = e.timeStamp || performance.now();

  let dt = (now - state.lastTimestamp) / 1000;
  if (dt <= 0.0001) dt = 0.016;
  if (dt > 0.1) dt = 0.016;
  state.lastTimestamp = now;

  // Resolve pressure
  let rawP = e.pressure;
  if (e.pointerType !== 'pen' || rawP === 0) {
    // Mouse velocity-dependent dynamic pressure synthesis
    const mouseDist = Math.hypot(targetX - state.lastMouseX, targetY - state.lastMouseY);
    const mouseSpeed = mouseDist / (dt * 1000);
    rawP = Math.max(0.15, Math.min(0.9, 0.75 - mouseSpeed * 0.08));
  }
  state.lastMouseX = targetX;
  state.lastMouseY = targetY;

  const calibratedP = calibratePressure(rawP, state.pressureCurve);

  // Spring-mass-damper physics update
  const dx = targetX - state.tipX;
  const dy = targetY - state.tipY;
  const fSpringX = state.springK * dx * 60;
  const fSpringY = state.springK * dy * 60;
  const fDampX = -state.dampingC * state.tipVx * 30;
  const fDampY = -state.dampingC * state.tipVy * 30;

  const speed = Math.hypot(state.tipVx, state.tipVy);
  let dragX = 0, dragY = 0, dragForce = 0;
  if (speed > 0.001) {
    const fStribeck = state.friction * (1.0 + calibratedP * 1.8);
    dragX = -(state.tipVx / speed) * fStribeck;
    dragY = -(state.tipVy / speed) * fStribeck;
    dragForce = fStribeck;
  }

  const ax = fSpringX + fDampX + dragX;
  const ay = fSpringY + fDampY + dragY;

  state.tipVx += ax * dt * 60;
  state.tipVy += ay * dt * 60;
  state.tipX += state.tipVx * dt * 60;
  state.tipY += state.tipVy * dt * 60;

  // Pressure hysteresis
  const pAlpha = calibratedP > state.smoothPressure ? 0.35 : 0.20;
  state.smoothPressure += pAlpha * (calibratedP - state.smoothPressure);

  // Caffeine jitter injection
  let finalX = state.tipX;
  let finalY = state.tipY;
  let finalP = state.smoothPressure;
  if (state.caffeine > 0.0) {
    const tremorFreq = 10.0;
    const tSec = now / 1000;
    finalX += Math.sin(tSec * tremorFreq * Math.PI * 2) * (state.caffeine * 3.5);
    finalY += Math.cos(tSec * tremorFreq * 1.1 * Math.PI * 2) * (state.caffeine * 3.5);
    finalP = Math.max(0, Math.min(1, finalP + (Math.random() - 0.5) * state.caffeine * 0.15));
  }

  // Ink reservoir consumption
  const inkDrained = (state.nibSize * 0.05 * finalP);
  state.reservoir = Math.max(0, state.reservoir - inkDrained);
  updateReservoirUI();

  const newPt = {
    x: finalX,
    y: finalY,
    pressure: finalP,
    tiltX: e.tiltX || 0,
    tiltY: e.tiltY || 0,
    timestamp: now
  };
  state.rawStrokePoints.push(newPt);

  // Draw immediate stroke segment
  drawActiveSegment(state.rawStrokePoints, state.currentBrush);

  // Update telemetry HUD
  updateHUD(finalP, e.tiltX || 0, e.tiltY || 0, speed / 100, dragForce);
  updateAudio(speed / 100, finalP);
});

canvas.addEventListener('pointerup', (e) => {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  stopAudio();

  if (state.rawStrokePoints.length > 1) {
    // Finish stroke and push to history
    state.completedStrokes.push({
      brush: state.currentBrush,
      color: state.currentColor,
      size: state.nibSize,
      points: [...state.rawStrokePoints]
    });
    state.redoStack = []; // clear redo on new action
    logTerminal(`Completed stroke: ${state.rawStrokePoints.length} points`, 'text-muted');
    hudBezierCount.textContent = state.completedStrokes.length;
  }
  state.rawStrokePoints = [];
});

canvas.addEventListener('pointercancel', () => {
  state.isDrawing = false;
  stopAudio();
  state.rawStrokePoints = [];
});

// ----------------- Rendering Engine -----------------
function drawActiveSegment(pts, brush) {
  if (pts.length < 2) return;
  const p1 = pts[pts.length - 2];
  const p2 = pts[pts.length - 1];

  ctx.save();

  if (brush === 'broad_nib') {
    // Gothic Chisel 45 degree ribbon
    const angleRad = Math.PI * 0.25; // 45 deg
    const halfW = (state.nibSize * 0.5) * (0.85 + 0.3 * p2.pressure);
    const dx = halfW * Math.cos(angleRad);
    const dy = halfW * Math.sin(angleRad);

    ctx.fillStyle = state.currentColor;
    ctx.beginPath();
    ctx.moveTo(p1.x - dx, p1.y - dy);
    ctx.lineTo(p1.x + dx, p1.y + dy);
    ctx.lineTo(p2.x + dx, p2.y + dy);
    ctx.lineTo(p2.x - dx, p2.y - dy);
    ctx.closePath();
    ctx.fill();

  } else if (brush === 'flex_nib') {
    // Vintage Flex Nib with tine deflection & railroading
    const maxSwell = state.nibSize * 2.2;
    const effectiveWidth = Math.max(1.5, Math.pow(p2.pressure, 1.8) * maxSwell);
    
    // Check railroading if moving fast under extreme pressure
    const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const isRailroading = (effectiveWidth > 18.0 && speed > 8.0);

    ctx.strokeStyle = state.currentColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isRailroading) {
      // Draw twin railroad hairline tracks
      const nx = -(p2.y - p1.y);
      const ny = (p2.x - p1.x);
      const len = Math.hypot(nx, ny) || 1;
      const perpX = (nx / len) * (effectiveWidth * 0.4);
      const perpY = (ny / len) * (effectiveWidth * 0.4);

      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(p1.x - perpX, p1.y - perpY);
      ctx.lineTo(p2.x - perpX, p2.y - perpY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(p1.x + perpX, p1.y + perpY);
      ctx.lineTo(p2.x + perpX, p2.y + perpY);
      ctx.stroke();
    } else {
      ctx.lineWidth = effectiveWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

  } else {
    // Standard XP-Pen Stylus or Ballpoint
    const baseW = state.nibSize * (0.2 + p2.pressure * 1.4);
    ctx.strokeStyle = state.currentColor;
    ctx.lineWidth = Math.max(1.0, baseW);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  ctx.restore();
}

function redrawAllStrokes() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of state.completedStrokes) {
    const pts = stroke.points;
    if (pts.length < 2) continue;
    
    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1];
      const p2 = pts[i];
      
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.brush === 'broad_nib') {
        const angleRad = Math.PI * 0.25;
        const halfW = (stroke.size * 0.5) * (0.85 + 0.3 * p2.pressure);
        const dx = halfW * Math.cos(angleRad);
        const dy = halfW * Math.sin(angleRad);
        ctx.beginPath();
        ctx.moveTo(p1.x - dx, p1.y - dy);
        ctx.lineTo(p1.x + dx, p1.y + dy);
        ctx.lineTo(p2.x + dx, p2.y + dy);
        ctx.lineTo(p2.x - dx, p2.y - dy);
        ctx.closePath();
        ctx.fill();
      } else {
        const baseW = stroke.size * (0.2 + p2.pressure * 1.4);
        ctx.lineWidth = Math.max(1.0, baseW);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// ----------------- Telemetry HUD Updates -----------------
function updateHUD(pressure, tiltX, tiltY, speed, drag) {
  // Pressure Gauge (0 to 8192)
  const hardwareLevel = Math.round(pressure * 8191);
  hudPressureVal.textContent = hardwareLevel;
  
  // Circumference = 2 * PI * 32 = 201.06
  const dashOffset = 201.06 * (1.0 - pressure);
  gaugePressureFill.style.strokeDashoffset = dashOffset;

  // Radar Puck
  updateRadarPuck(tiltX, tiltY);

  hudSpeed.textContent = `${speed.toFixed(1)} px/ms`;
  hudDrag.textContent = `${drag.toFixed(2)} N`;
}

function updateRadarPuck(tx, ty) {
  hudTiltX.textContent = `Tx: ${Math.round(tx)}°`;
  hudTiltY.textContent = `Ty: ${Math.round(ty)}°`;
  
  // Radar radius is ~24px
  const maxTilt = 60.0;
  const px = (tx / maxTilt) * 22;
  const py = (ty / maxTilt) * 22;
  radarPuck.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
}

function updateReservoirUI() {
  const pct = Math.round((state.reservoir / state.maxReservoir) * 100);
  reservoirFill.style.width = `${pct}%`;
  reservoirLabel.textContent = `Ink Reservoir: ${pct}%`;
}

// ----------------- Generative Triggers via Python -----------------
async function runGenerativePen(type) {
  logTerminal(`Executing Python generative generator: ${type}...`, 'text-cyan');
  
  const rect = canvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  let points = [];

  if (state.pyodideReady) {
    try {
      let pyCall = "";
      if (type === 'spiro') {
        pyCall = `generate_spirograph_py(R=220, r=84, d=110, cx=${cx}, cy=${cy}, samples=2400)`;
      } else if (type === 'lorenz') {
        pyCall = `generate_lorenz_py(steps=4200, scale=12.5, cx=${cx}, cy=${cy})`;
      } else if (type === 'harmonograph') {
        pyCall = `generate_harmonograph_py(cx=${cx}, cy=${cy}, samples=3200)`;
      }
      const pyResult = await state.pyodide.runPythonAsync(pyCall);
      points = pyResult.toJs();
    } catch (err) {
      console.warn("Python execution err, using JS generator:", err);
      points = generateFallbackPath(type, cx, cy);
    }
  } else {
    points = generateFallbackPath(type, cx, cy);
  }

  // Animate the path drawing on canvas
  animateStrokePoints(points, state.currentColor);
  closeAllModals();
}

function generateFallbackPath(type, cx, cy) {
  const pts = [];
  if (type === 'spiro') {
    const R = 220, r = 84, d = 110;
    const diff = R - r;
    const ratio = diff / r;
    for (let i = 0; i < 2400; i++) {
      const theta = i * (Math.PI * 2 * 14 / 2400);
      const x = diff * Math.cos(theta) + d * Math.cos(ratio * theta);
      const y = diff * Math.sin(theta) - d * Math.sin(ratio * theta);
      pts.push({ x: cx + x, y: cy + y, pressure: 0.6 });
    }
  } else if (type === 'lorenz') {
    let x = 0.1, y = 0, z = 0;
    const dt = 0.007;
    for (let i = 0; i < 3500; i++) {
      const dx = 10 * (y - x);
      const dy = x * (28 - z) - y;
      const dz = x * y - (8/3) * z;
      x += dx * dt; y += dy * dt; z += dz * dt;
      pts.push({ x: cx + x * 12, y: cy + (z - 25) * 11, pressure: Math.min(1, z / 40) });
    }
  } else {
    for (let i = 0; i < 2800; i++) {
      const t = i * 0.02;
      const decay = Math.exp(-0.0018 * t * 10);
      const x = 180 * Math.sin(2.001 * t) * decay;
      const y = 180 * Math.sin(3.002 * t + Math.PI/2) * decay;
      pts.push({ x: cx + x, y: cy + y, pressure: 0.3 + 0.6 * decay });
    }
  }
  return pts;
}

function animateStrokePoints(pts, color) {
  if (!pts || pts.length === 0) return;
  let idx = 0;
  const batch = 25;

  function step() {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let b = 0; b < batch && idx < pts.length - 1; b++) {
      const p1 = pts[idx];
      const p2 = pts[idx + 1];
      ctx.lineWidth = Math.max(1.2, (p2.pressure || 0.5) * 5.0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      idx++;
    }
    ctx.restore();

    if (idx < pts.length - 1) {
      requestAnimationFrame(step);
    } else {
      state.completedStrokes.push({
        brush: 'xppen_stylus',
        color: color,
        size: state.nibSize,
        points: pts
      });
      hudBezierCount.textContent = state.completedStrokes.length;
      logTerminal("Generative artwork rendering complete!", "text-green");
    }
  }
  requestAnimationFrame(step);
}

// ----------------- Python REPL Sandbox Execution -----------------
async function runCustomPythonScript() {
  const code = document.getElementById('python-code-input').value;
  const statusEl = document.getElementById('python-run-output');
  statusEl.textContent = "Executing in WebAssembly...";
  statusEl.style.color = "#38bdf8";

  // Expose render callback to python environment
  window.render_stroke_on_canvas = (pts, color = '#00f2fe', size = 3) => {
    const jsPts = Array.isArray(pts) ? pts : (pts.toJs ? pts.toJs() : []);
    animateStrokePoints(jsPts, color);
  };

  try {
    if (!state.pyodideReady) {
      throw new Error("Pyodide engine is still initializing. Please wait a moment!");
    }
    await state.pyodide.runPythonAsync(code);
    statusEl.textContent = "Execution Successful! Check canvas.";
    statusEl.style.color = "#10b981";
    logTerminal("Custom Python script executed cleanly.", "text-green");
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = "#ef4444";
    logTerminal(`Python Error: ${err.message}`, "text-muted");
  }
}

// ----------------- G-Code Visualizer & Exporter -----------------
function openGCodeModal() {
  const modal = document.getElementById('modal-gcode');
  modal.classList.remove('hidden');

  const strokesCount = state.completedStrokes.length;
  document.getElementById('gcode-stat-strokes').textContent = strokesCount;

  const gcodeCanvas = document.getElementById('gcode-preview-canvas');
  const gctx = gcodeCanvas.getContext('2d');
  gctx.clearRect(0, 0, gcodeCanvas.width, gcodeCanvas.height);

  if (strokesCount === 0) {
    document.getElementById('gcode-output-area').value = "; Canvas is empty! Draw something first bro.";
    return;
  }

  // Scale factor to fit preview canvas
  const scale = 0.45;
  gctx.save();
  gctx.lineWidth = 1.5;

  let lastX = 0, lastY = 0;
  for (let sIdx = 0; sIdx < state.completedStrokes.length; sIdx++) {
    const pts = state.completedStrokes[sIdx].points;
    if (pts.length === 0) continue;

    // 1. Draw dashed rapid travel line (Pen UP)
    if (sIdx > 0) {
      gctx.strokeStyle = '#ec4899';
      gctx.setLineDash([4, 4]);
      gctx.beginPath();
      gctx.moveTo(lastX * scale, lastY * scale);
      gctx.lineTo(pts[0].x * scale, pts[0].y * scale);
      gctx.stroke();
      gctx.setLineDash([]);
    }

    // 2. Draw solid drawing line (Pen DOWN)
    gctx.strokeStyle = '#00f2fe';
    gctx.beginPath();
    gctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    for (let i = 1; i < pts.length; i++) {
      gctx.lineTo(pts[i].x * scale, pts[i].y * scale);
    }
    gctx.stroke();

    lastX = pts[pts.length - 1].x;
    lastY = pts[pts.length - 1].y;
  }
  gctx.restore();

  // Generate G-code text
  generateGCodeText();
}

function generateGCodeText() {
  const lines = [
    "; --- Generated by XPpen Studio 2-Opt G-Code Engine ---",
    "; Mode: High-Precision Dynamic Pressure Plotter",
    "G21 ; Millimeters",
    "G90 ; Absolute coordinates",
    "G00 Z5.00 F4500 ; Pen UP",
    "G04 P150 ; Dwell for servo stabilization",
    ""
  ];

  const px2mm = 0.264583;
  for (let sIdx = 0; sIdx < state.completedStrokes.length; sIdx++) {
    const pts = state.completedStrokes[sIdx].points;
    if (pts.length === 0) continue;

    const startX = (pts[0].x * px2mm).toFixed(3);
    const startY = (pts[0].y * px2mm).toFixed(3);

    lines.push(`; Stroke #${sIdx + 1}`);
    lines.push(`G00 X${startX} Y${startY} F4500`);
    lines.push(`G01 Z0.00 F1800 ; Pen DOWN`);

    for (let i = 1; i < pts.length; i++) {
      const px = (pts[i].x * px2mm).toFixed(3);
      const py = (pts[i].y * px2mm).toFixed(3);
      const z = (-(pts[i].pressure * 1.2)).toFixed(3);
      lines.push(`G01 X${px} Y${py} Z${z} F1800`);
    }

    lines.push(`G00 Z5.00 F4500 ; Pen UP`);
    lines.push("");
  }

  lines.push("G00 X0.00 Y0.00 Z5.00 F4500 ; Park at Home");
  lines.push("M02 ; Program End");

  document.getElementById('gcode-output-area').value = lines.join("\n");
}

// ----------------- Export Functions -----------------
function exportSVG() {
  if (state.completedStrokes.length === 0) {
    alert("Canvas is empty! Draw something cool first bro.");
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;
  svg += `  <rect width="100%" height="100%" fill="#07090e" />\n`;

  for (const stroke of state.completedStrokes) {
    const pts = stroke.points;
    if (pts.length < 2) continue;

    let pathD = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} `;
    for (let i = 1; i < pts.length; i++) {
      pathD += `L ${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} `;
    }

    const strokeW = Math.max(1.2, stroke.size * 0.7);
    svg += `  <path d="${pathD.trim()}" fill="none" stroke="${stroke.color}" stroke-width="${strokeW.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" />\n`;
  }

  svg += `</svg>`;

  downloadFile("xppen_artwork.svg", svg, "image/svg+xml");
  logTerminal("Exported vector SVG successfully!", "text-green");
}

function exportPNG() {
  const link = document.createElement('a');
  link.download = 'xppen_artwork.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  logTerminal("Exported high-res PNG successfully!", "text-green");
}

function exportGCodeFile() {
  const gcodeStr = document.getElementById('gcode-output-area').value;
  downloadFile("xppen_plot.gcode", gcodeStr, "text/plain");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ----------------- UI Event Bindings -----------------

// Brush buttons
document.querySelectorAll('.brush-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentBrush = btn.dataset.brush;
    logTerminal(`Switched instrument to: ${btn.querySelector('.brush-name').textContent}`);
  });
});

// Color swatches
document.querySelectorAll('.color-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    state.currentColor = swatch.dataset.color;
  });
});

document.getElementById('custom-color-picker').addEventListener('input', (e) => {
  state.currentColor = e.target.value;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
});

// Nib size slider
const sliderNibSize = document.getElementById('slider-nib-size');
const valNibSize = document.getElementById('val-nib-size');
sliderNibSize.addEventListener('input', (e) => {
  state.nibSize = parseInt(e.target.value, 10);
  valNibSize.textContent = `${state.nibSize}px`;
});

// Dip in inkwell
document.getElementById('btn-dip-ink').addEventListener('click', () => {
  state.reservoir = state.maxReservoir;
  updateReservoirUI();
  logTerminal("Refilled ink reservoir to 100%! Ready to ink.", "text-cyan");
});

// Pressure curve buttons
document.querySelectorAll('.btn-curve').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-curve').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.pressureCurve = btn.dataset.curve;
    logTerminal(`Calibrated hardware curve: ${state.pressureCurve}`);
  });
});

// Sliders: Spring k, Damping c, Friction, Bezier eps, Caffeine
document.getElementById('slider-spring-k').addEventListener('input', (e) => {
  state.springK = parseFloat(e.target.value);
  document.getElementById('val-spring-k').textContent = state.springK.toFixed(2);
});

document.getElementById('slider-damping-c').addEventListener('input', (e) => {
  state.dampingC = parseFloat(e.target.value);
  document.getElementById('val-damping-c').textContent = state.dampingC.toFixed(2);
});

document.getElementById('slider-friction').addEventListener('input', (e) => {
  state.friction = parseFloat(e.target.value);
  document.getElementById('val-friction').textContent = state.friction.toFixed(2);
});

document.getElementById('slider-bezier-eps').addEventListener('input', (e) => {
  state.bezierEps = parseFloat(e.target.value);
  document.getElementById('val-bezier-eps').textContent = `${state.bezierEps.toFixed(1)} px`;
});

document.getElementById('slider-caffeine').addEventListener('input', (e) => {
  state.caffeine = parseFloat(e.target.value);
  document.getElementById('val-caffeine').textContent = state.caffeine.toFixed(2);
  if (state.caffeine > 0.5) {
    logTerminal("⚠️ High caffeine detected! Hand tremor active.", "text-purple");
  }
});

// Audio toggle
document.getElementById('btn-sound-toggle').addEventListener('click', () => {
  state.audioEnabled = !state.audioEnabled;
  const icon = document.getElementById('sound-icon');
  icon.textContent = state.audioEnabled ? '🔊' : '🔇';
  if (state.audioEnabled) {
    initAudio();
    logTerminal("Paper scratching ASMR audio enabled.");
  } else {
    stopAudio();
    logTerminal("Audio muted.");
  }
});

// Undo
document.getElementById('btn-undo').addEventListener('click', () => {
  if (state.completedStrokes.length > 0) {
    state.redoStack.push(state.completedStrokes.pop());
    redrawAllStrokes();
    hudBezierCount.textContent = state.completedStrokes.length;
    logTerminal("Undid last stroke.");
  }
});

// Clear
document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm("Clear the entire canvas bro?")) {
    state.completedStrokes = [];
    state.redoStack = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hudBezierCount.textContent = 0;
    logTerminal("Canvas cleared.");
  }
});

// Navigation tabs & modals
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-studio').classList.add('active');
}

document.querySelectorAll('.btn-close-modal').forEach(btn => {
  btn.addEventListener('click', closeAllModals);
});

document.getElementById('tab-studio').addEventListener('click', closeAllModals);

document.getElementById('tab-generative').addEventListener('click', () => {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-generative').classList.add('active');
  document.getElementById('modal-generative').classList.remove('hidden');
});

document.getElementById('tab-python').addEventListener('click', () => {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-python').classList.add('active');
  document.getElementById('modal-python').classList.remove('hidden');
});

document.getElementById('tab-gcode').addEventListener('click', () => {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-gcode').classList.add('active');
  openGCodeModal();
});

// Generative generator buttons inside modal
document.querySelectorAll('.btn-run-gen').forEach(btn => {
  btn.addEventListener('click', () => {
    runGenerativePen(btn.dataset.gen);
  });
});

// Python REPL modal buttons
document.getElementById('btn-run-python-code').addEventListener('click', runCustomPythonScript);
document.getElementById('btn-reset-python-code').addEventListener('click', () => {
  document.getElementById('python-code-input').value = `# XPpen In-Browser Python Studio Script
import math

print("Bro, running custom Python math directly on the canvas!")

cx, cy = 450, 350
spiral_points = []
for i in range(1200):
    theta = i * 0.05
    r = 2.2 * math.sqrt(i) * 5.0
    x = cx + r * math.cos(theta)
    y = cy + r * math.sin(theta)
    p = 0.3 + 0.6 * math.sin(theta * 2.0)
    spiral_points.append({"x": round(x, 2), "y": round(y, 2), "pressure": max(0.1, round(p, 3))})

render_stroke_on_canvas(spiral_points, "#00f2fe", 4.0)
print(f"Generated {len(spiral_points)} Fibonacci spiral points in Python!")
`;
  document.getElementById('python-run-output').textContent = "Script reset.";
});

// Export dropdown
const exportMenuBtn = document.getElementById('btn-export-menu');
const exportDropdown = document.getElementById('export-dropdown');
exportMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle('show');
});

window.addEventListener('click', () => {
  exportDropdown.classList.remove('show');
});

document.getElementById('export-svg').addEventListener('click', exportSVG);
document.getElementById('export-png').addEventListener('click', exportPNG);
document.getElementById('export-gcode-btn').addEventListener('click', openGCodeModal);
document.getElementById('btn-download-gcode-file').addEventListener('click', exportGCodeFile);

document.getElementById('btn-copy-gcode').addEventListener('click', () => {
  const gcodeText = document.getElementById('gcode-output-area').value;
  navigator.clipboard.writeText(gcodeText).then(() => {
    alert("Copied G-Code to clipboard bro!");
  });
});

document.getElementById('export-python-script').addEventListener('click', () => {
  const pyScript = `# XPpen Replay Script
import json

strokes = ${JSON.stringify(state.completedStrokes, null, 2)}
print(f"Replaying {len(strokes)} XPpen strokes in Python...")
`;
  downloadFile("replay_xppen.py", pyScript, "text/x-python");
});

// Keyboard shortcuts (Ctrl+Z for Undo)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    document.getElementById('btn-undo').click();
  }
});

// Boot init
window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  initPyodideEngine();
  logTerminal("XPpen Studio Initialized. 8192 Pressure Digitzer listening.");
});
