import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// --- LOAD FONT ---
const link = document.createElement("link");
link.rel = "stylesheet";
link.href =
  "https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap";
document.head.appendChild(link);

// --- INJECT CSS ---
const style = document.createElement("style");
style.innerHTML = `
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #445566; border-radius: 10px; }

    .glass-panel { -ms-overflow-style: none; scrollbar-width: none; }
    .glass-panel::-webkit-scrollbar { display: none; }

    input[type=range] { -webkit-appearance: none; width: 80px; background: transparent; flex-shrink: 0; }
    input[type=range]:focus { outline: none; }
    input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; cursor: pointer; background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
    input[type=range]::-webkit-slider-thumb { height: 12px; width: 12px; border-radius: 50%; background: #00ffff; cursor: pointer; -webkit-appearance: none; margin-top: -4px; transition: transform 0.1s; }
    input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.3); }

    .crt-active {
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
        background-size: 100% 3px, 3px 100%;
        box-shadow: inset 0 0 80px rgba(0,0,0,0.6);
        pointer-events: none;
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999;
    }
    
    .glass-panel {
        background: rgba(10, 12, 16, 0.85); backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px;
    }

    .btn-icon { position: relative; flex-shrink: 0; }
    .btn-icon:hover::after {
        content: attr(data-tooltip);
        position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9); color: #00ffff; padding: 6px 10px; font-size: 11px;
        border-radius: 4px; white-space: nowrap; pointer-events: none;
        border: 1px solid #334; font-family: 'Rajdhani', sans-serif; font-weight: 600; letter-spacing: 1px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5); opacity: 0; animation: fadeIn 0.2s forwards; z-index: 1000;
    }
    @keyframes fadeIn { to { opacity: 1; } }

    @media (max-width: 768px) {
        #hud-container { transform: scale(0.85); transform-origin: top left; top: 10px; left: 10px; }
        #command-deck { width: 95vw; bottom: 15px; padding: 10px 15px; gap: 10px; overflow-x: auto; justify-content: flex-start; white-space: nowrap; }
        .hide-mobile { display: none; }
    }

    .shine-text { color: #ffffff !important; text-shadow: 0 0 10px #ffffff, 0 0 20px #88ccff, 0 0 30px #ffffff !important; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { opacity: 0.8; } 50% { opacity: 1.0; } 100% { opacity: 0.8; } }

    .ui-element { transition: opacity 0.5s ease; }
    .hidden { opacity: 0 !important; pointer-events: none; }
`;
document.head.appendChild(style);

const crtDiv = document.createElement("div");
crtDiv.id = "crt-overlay";
crtDiv.className = "crt-active";
document.body.appendChild(crtDiv);

// --- STATE VARIABLES ---
let bodies = [];
let simMode = "FIGURE-8";
let stabilityStatus = "BOUNDED";
let physicsSubsteps = 10;
let presetTimeScale = 1.0;
let userTimeScale = 1.0;
let cinematic = false;
let paused = false;
let cameraLocked = false;
let lockedBody = null;
let enableMerge = true;
let traceMode = false;
let showWeb = false;
let showVectors = true;
let crtEnabled = true;
let currentSoftening = 0.0001;
let useRepulsion = false;
let collisionCount = 0; // New Stat
let simTime = 0.0; // New Stat

// --- CONFIGURATION ---
const G = 1.0;
const DT = 0.015;
const MAX_TRAIL = 40000;
const MAX_BODIES = 40;
const LINK_THRESHOLD = 150.0;

// --- COLOR LOGIC ---
function getStarColor(mass) {
  const color = new THREE.Color();
  const cRed = new THREE.Color(0xff3300);
  const cYellow = new THREE.Color(0xffaa00);
  const cWhite = new THREE.Color(0xffffff);
  const cCyan = new THREE.Color(0x00ccff);
  const cViolet = new THREE.Color(0xaa00ff);
  const cNeutron = new THREE.Color(0xffffff);
  const cBlack = new THREE.Color(0x050505);

  if (mass < 100.0) {
    color.lerpColors(cRed, cYellow, mass / 100.0);
  } else if (mass < 300.0) {
    color.lerpColors(cYellow, cWhite, (mass - 100.0) / 200.0);
  } else if (mass < 800.0) {
    color.lerpColors(cWhite, cCyan, (mass - 300.0) / 500.0);
  } else if (mass < 2000.0) {
    color.lerpColors(cCyan, cViolet, (mass - 800.0) / 1200.0);
  } else if (mass < 4000.0) {
    color.lerpColors(cViolet, cNeutron, (mass - 2000.0) / 2000.0);
  } else {
    color.lerpColors(cNeutron, cBlack, Math.min((mass - 4000.0) / 2000.0, 1.0));
  }
  return color.getHex();
}

const PRESETS = {
  figure8: {
    name: "FIGURE-8",
    substeps: 10,
    dt_mult: 1.0,
    softening: 0.0001,
    repulsion: false,
    bodies: [
      {
        x: 0.97000436,
        y: -0.24308753,
        z: 0,
        vx: 0.466203685,
        vy: 0.43236573,
        vz: 0,
        m: 1,
      },
      {
        x: -0.97000436,
        y: 0.24308753,
        z: 0,
        vx: 0.466203685,
        vy: 0.43236573,
        vz: 0,
        m: 1,
      },
      {
        x: 0,
        y: 0,
        z: 0,
        vx: -2 * 0.466203685,
        vy: -2 * 0.43236573,
        vz: 0,
        m: 1,
      },
    ],
  },
};

// --- UI CONSTRUCTION ---
const hudContainer = document.createElement("div");
hudContainer.id = "hud-container";
hudContainer.className = "ui-element glass-panel";
Object.assign(hudContainer.style, {
  position: "absolute",
  top: "20px",
  left: "20px",
  padding: "16px",
  width: "200px",
  fontFamily: "'Rajdhani', sans-serif",
});
document.body.appendChild(hudContainer);

const deck = document.createElement("div");
deck.id = "command-deck";
deck.className = "ui-element glass-panel";
Object.assign(deck.style, {
  position: "absolute",
  bottom: "30px",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  gap: "16px",
  padding: "10px 24px",
  alignItems: "center",
  fontFamily: "'Rajdhani', sans-serif",
  zIndex: "100",
});
document.body.appendChild(deck);

const hintDiv = document.createElement("div");
hintDiv.className = "ui-element hide-mobile";
Object.assign(hintDiv.style, {
  position: "absolute",
  bottom: "10px",
  right: "15px",
  color: "rgba(255,255,255,0.3)",
  fontSize: "11px",
  fontWeight: "600",
  fontFamily: "'Rajdhani', sans-serif",
  letterSpacing: "1px",
});
hintDiv.innerText = "[SPACE] PAUSE  |  [H] HIDE";
document.body.appendChild(hintDiv);

function updateHUD() {
  let maxMass = 0;
  if (bodies.length > 0)
    maxMass = bodies.reduce((prev, current) =>
      prev.mass > current.mass ? prev : current,
    ).mass;

  let domColorHex = getStarColor(maxMass);
  let domColorStr = "#" + new THREE.Color(domColorHex).getHexString();
  let domClass = maxMass > 4000 ? "shine-text" : "";
  const statusDotColor = paused ? "#ffaa00" : "#00ff88"; // Orange if paused

  hudContainer.innerHTML = `
        <div style="font-size:16px; font-weight:700; color:#fff; margin-bottom:12px; letter-spacing:1px; display:flex; justify-content:space-between; align-items:center;">
            <span>ORBITAL ENGINE</span>
            <div style="width:8px; height:8px; background:${statusDotColor}; border-radius:50%; box-shadow:0 0 8px ${statusDotColor}; animation: ${paused ? "none" : "pulse 2s infinite"};"></div>
        </div>
        <div style="font-size:12px; color:#889; display:grid; grid-template-columns:1fr 1fr; gap:6px;">
            <span>STABILITY</span> <span style="text-align:right; color:#00ff88">${stabilityStatus}</span>
            <span>COUNT</span> <span style="text-align:right; color:#fff">${bodies.length} / ${MAX_BODIES}</span>
            <span>LARGEST</span> <span class="${domClass}" style="text-align:right; ${domClass ? "" : "color:" + domColorStr}">${maxMass.toFixed(1)} M☉</span>
            <span>MERGES</span> <span style="text-align:right; color:#aab">${collisionCount}</span>
            <span>TIME</span> <span style="text-align:right; color:#fff">T+${simTime.toFixed(1)} YR</span>
        </div>
        <div style="margin-top:12px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1); font-size:11px; color:#667;">
            APP // <span style="color:#00ffff">NBODY-SIMULATOR</span>
        </div>
    `;

  updateButtonVisuals();
}

// --- COMMAND DECK ---
const grpPlay = document.createElement("div");
grpPlay.style.display = "flex";
grpPlay.style.gap = "8px";
grpPlay.style.alignItems = "center";
grpPlay.style.borderRight = "1px solid rgba(255,255,255,0.1)";
grpPlay.style.paddingRight = "16px";
deck.appendChild(grpPlay);

const I_PLAY = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const I_PAUSE = `<svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const I_RESET = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const I_ADD = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
const I_CHAOS = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

function createIconBtn(iconHtml, tooltip, onClick) {
  const btn = document.createElement("button");
  btn.innerHTML = iconHtml;
  btn.className = "btn-icon";
  btn.dataset.tooltip = tooltip;
  Object.assign(btn.style, {
    background: "rgba(255,255,255,0.05)",
    border: "none",
    borderRadius: "8px",
    color: "#ccc",
    cursor: "pointer",
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
  });
  btn.onmouseenter = () => (btn.style.background = "rgba(255,255,255,0.2)");
  btn.onmouseleave = () => (btn.style.background = "rgba(255,255,255,0.05)");
  btn.onclick = onClick;
  return btn;
}

const btnPause = createIconBtn(I_PAUSE, "Play/Pause", () => {
  togglePause();
});
grpPlay.appendChild(btnPause);
const btnReset = createIconBtn(I_RESET, "Reset Scene", () => {
  loadPreset("figure8");
});
grpPlay.appendChild(btnReset);

const speedSlider = document.createElement("input");
speedSlider.type = "range";
speedSlider.min = "0.1";
speedSlider.max = "3.0";
speedSlider.step = "0.1";
speedSlider.value = "1.0";
speedSlider.title = "Sim Speed";
speedSlider.oninput = (e) => (userTimeScale = parseFloat(e.target.value));
grpPlay.appendChild(speedSlider);

const grpTools = document.createElement("div");
grpTools.style.display = "flex";
grpTools.style.gap = "8px";
grpTools.style.borderRight = "1px solid rgba(255,255,255,0.1)";
grpTools.style.paddingRight = "16px";
deck.appendChild(grpTools);

const btnAdd = createIconBtn(I_ADD, "Add Body", () => addRandomBody());
grpTools.appendChild(btnAdd);
const btnChaos = createIconBtn(I_CHAOS, "Chaos Mode", () => setChaosMode());
grpTools.appendChild(btnChaos);

const grpVis = document.createElement("div");
grpVis.style.display = "flex";
grpVis.style.gap = "6px";
deck.appendChild(grpVis);

function createToggle(text, tooltip, getter, setter) {
  const btn = document.createElement("button");
  btn.innerText = text;
  btn.className = "btn-icon";
  btn.dataset.tooltip = tooltip;
  Object.assign(btn.style, {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "6px",
    color: "#889",
    cursor: "pointer",
    fontSize: "10px",
    fontWeight: "700",
    padding: "0 10px",
    height: "36px",
    fontFamily: "'Rajdhani'",
  });
  btn.onclick = () => {
    setter();
    updateButtonVisuals();
  };
  btn.updateState = () => {
    const active = getter();
    btn.style.borderColor = active ? "#00ffff" : "rgba(255,255,255,0.2)";
    btn.style.color = active ? "#00ffff" : "#889";
    btn.style.boxShadow = active ? "0 0 10px rgba(0,255,255,0.15)" : "none";
    btn.style.background = active ? "rgba(0,255,255,0.05)" : "transparent";
  };
  grpVis.appendChild(btn);
  return btn;
}

const tMerge = createToggle(
  "MERGE",
  "Merge Collisions",
  () => enableMerge,
  toggleMerge,
);
const tLock = createToggle(
  "LOCK",
  "Lock Camera",
  () => cameraLocked,
  toggleLock,
);
const tTrace = createToggle(
  "TRAIL",
  "Toggle Trails",
  () => traceMode,
  toggleTrace,
);
const tWeb = createToggle("WEB", "Gravity Web", () => showWeb, toggleWeb);
const tVec = createToggle("VEC", "Vectors", () => showVectors, toggleVectors);
const tCRT = createToggle("CRT", "CRT Effect", () => crtEnabled, toggleCRT);

function updateButtonVisuals() {
  btnPause.innerHTML = paused ? I_PLAY : I_PAUSE;
  tMerge.updateState();
  tLock.updateState();
  tTrace.updateState();
  tWeb.updateState();
  tVec.updateState();
  tCRT.updateState();
}

function togglePause() {
  paused = !paused;
  updateHUD();
}
function toggleMerge() {
  enableMerge = !enableMerge;
  updateHUD();
}
function toggleLock() {
  cameraLocked = !cameraLocked;
  if (cameraLocked && bodies.length > 0) {
    let maxMass = -1;
    let heaviest = null;
    for (let b of bodies) {
      if (b.mass > maxMass) {
        maxMass = b.mass;
        heaviest = b;
      }
    }
    lockedBody = heaviest;
  } else {
    lockedBody = null;
  }
  updateHUD();
}
function toggleTrace() {
  traceMode = !traceMode;
  if (!traceMode) {
    for (let b of bodies) {
      b.history = [];
      b.trail.geometry.setDrawRange(0, 0);
    }
  }
  updateHUD();
}
function toggleWeb() {
  showWeb = !showWeb;
  linkMesh.visible = showWeb;
  updateHUD();
}
function toggleVectors() {
  showVectors = !showVectors;
  updateHUD();
}
function toggleCRT() {
  crtEnabled = !crtEnabled;
  const crt = document.getElementById("crt-overlay");
  if (crtEnabled) crt.classList.add("crt-active");
  else crt.classList.remove("crt-active");
  updateHUD();
}
function toggleCinematic() {
  cinematic = !cinematic;
  const uis = document.querySelectorAll(".ui-element");
  uis.forEach((ui) => {
    if (cinematic) ui.classList.add("hidden");
    else ui.classList.remove("hidden");
  });
}

function checkStability() {
  if (bodies.length < 2) return "N/A";
  let maxDist = 0;
  for (let b of bodies) {
    const d = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
    if (d > maxDist) maxDist = d;
  }
  // Increased threshold to 2500 due to larger universe size
  if (maxDist > 2500) return "ESCAPE DETECTED";
  if (simMode === "LAGRANGE TRIANGLE") return "METASTABLE";
  return "BOUNDED";
}

window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") toggleCinematic();
  if (e.code === "Space") togglePause();
});

// --- THREE.JS SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x020203, 0.00045);

// STARS
function getCircleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}
const starsGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(200000 * 3);
const starVec = new THREE.Vector3();
for (let i = 0; i < 200000; i++) {
  starVec.randomDirection();
  const dist = 2000 + Math.random() * 8000;
  starVec.multiplyScalar(dist);
  starPos[i * 3] = starVec.x;
  starPos[i * 3 + 1] = starVec.y;
  starPos[i * 3 + 2] = starVec.z;
}
starsGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const starsMat = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 2.5,
  transparent: true,
  opacity: 0.9,
  map: getCircleTexture(),
  alphaTest: 0.1,
});
scene.add(new THREE.Points(starsGeo, starsMat));

// NEBULA
function getBrushTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    const x = 128 + (Math.random() - 0.5) * 120;
    const y = 128 + (Math.random() - 0.5) * 120;
    const w = 20 + Math.random() * 40;
    const h = 5 + Math.random() * 10;
    const rot = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.005 + Math.random() * 0.01})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}
const brushTex = getBrushTexture();
const nebulaGroup = new THREE.Group();
const NEBULA_COLORS = [
  0x220088, 0x880044, 0x0088cc, 0xaa6600, 0x440088, 0x00aa55,
];

for (let i = 0; i < 1500; i++) {
  const color = NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
  const mat = new THREE.SpriteMaterial({
    map: brushTex,
    color: color,
    transparent: true,
    opacity: 0.02,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cloud = new THREE.Sprite(mat);
  const scale = 400 + Math.random() * 600;
  cloud.scale.set(scale, scale, 1);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 500 + Math.random() * 4500;
  cloud.position.set(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  );
  cloud.material.rotation = Math.random() * Math.PI;
  cloud.userData = { rotSpeed: (Math.random() - 0.5) * 0.0005 };
  nebulaGroup.add(cloud);
}
const clusterCenters = [];
for (let i = 0; i < 5; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 2000 + Math.random() * 3000;
  clusterCenters.push(
    new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    ),
  );
}
for (let i = 0; i < 5; i++) {
  const center = clusterCenters[i];
  const clusterColor =
    NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
  for (let j = 0; j < 300; j++) {
    const mat = new THREE.SpriteMaterial({
      map: brushTex,
      color: clusterColor,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloud = new THREE.Sprite(mat);
    const scale = 200 + Math.random() * 400;
    cloud.scale.set(scale, scale, 1);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.random() * 800;
    const offset = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
    );
    cloud.position.copy(center).add(offset);
    cloud.material.rotation = Math.random() * Math.PI;
    cloud.userData = { rotSpeed: (Math.random() - 0.5) * 0.001 };
    nebulaGroup.add(cloud);
  }
}
scene.add(nebulaGroup);

// LINKS
const maxLinks = (MAX_BODIES * (MAX_BODIES - 1)) / 2;
const linkGeo = new THREE.BufferGeometry();
const linkPos = new Float32Array(maxLinks * 2 * 3);
linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
const linkMat = new THREE.LineBasicMaterial({
  color: 0x00ffff,
  transparent: true,
  opacity: 0.1,
  blending: THREE.AdditiveBlending,
});
const linkMesh = new THREE.LineSegments(linkGeo, linkMat);
linkMesh.visible = false;
scene.add(linkMesh);

const explosions = [];
function createExplosion(x, y, z, color) {
  const count = 30;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
      ),
    );
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: color,
    size: 0.06,
    transparent: true,
    opacity: 1.0,
    map: getCircleTexture(),
    blending: THREE.AdditiveBlending,
  });
  const pSystem = new THREE.Points(geometry, material);
  scene.add(pSystem);
  explosions.push({ mesh: pSystem, vels: velocities, age: 0 });
}

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  200000,
);
camera.position.set(0, 6, 20);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;

// --- PHYSICS & LOGIC ---
function clearScene() {
  for (let b of bodies) {
    scene.remove(b.mesh);
    scene.remove(b.trail);
    scene.remove(b.arrow);
    if (b.ring) scene.remove(b.ring);
    b.mesh.geometry.dispose();
    b.mesh.material.dispose();
    b.trail.geometry.dispose();
    b.trail.material.dispose();
    if (b.arrow) b.arrow.dispose();
    if (b.ring) {
      b.ring.geometry.dispose();
      b.ring.material.dispose();
    }
  }
  bodies = [];
  collisionCount = 0;
  simTime = 0.0;
  updateHUD();
}

function createBody(x, y, z, vx, vy, vz, mass) {
  const color = getStarColor(mass);
  let radius;
  if (mass > 4000) {
    const excess = mass - 4000;
    radius = Math.max(0.5, 0.08 * Math.sqrt(4000) * (1000 / (1000 + excess)));
  } else {
    radius = 0.08 * Math.sqrt(mass);
  }

  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const material = new THREE.MeshBasicMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const ringGeo = new THREE.RingGeometry(radius * 1.1, radius * 1.5, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.0,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  const bufferSize = MAX_TRAIL;
  const trailGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(bufferSize * 3);
  trailGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  trailGeo.setDrawRange(0, 0);
  const trailColor = mass > 4000 ? 0xffffff : color;
  const trailMat = new THREE.LineBasicMaterial({
    color: trailColor,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);

  const arrowDir = new THREE.Vector3(vx, vy, vz).normalize();
  const arrow = new THREE.ArrowHelper(
    arrowDir,
    new THREE.Vector3(x, y, z),
    0.3,
    color,
    0.1,
    0.05,
  );
  arrow.line.material.opacity = 0.4;
  arrow.line.material.transparent = true;
  arrow.cone.material.opacity = 0.4;
  arrow.cone.material.transparent = true;
  scene.add(arrow);

  bodies.push({
    x: x,
    y: y,
    z: z,
    vx: vx,
    vy: vy,
    vz: vz,
    mass: mass,
    mesh: mesh,
    ring: ring,
    trail: trail,
    arrow: arrow,
    history: [],
    positions: positions,
  });
  updateHUD();
}

function loadPreset(key) {
  clearScene();
  controls.target.set(0, 0, 0);
  cameraLocked = false;
  const preset = PRESETS[key];
  simMode = preset.name;
  physicsSubsteps = preset.substeps || 10;
  presetTimeScale = preset.dt_mult || 1.0;
  // APPLY PHYSICS MODE
  currentSoftening = preset.softening;
  useRepulsion = preset.repulsion;
  preset.bodies.forEach((b) =>
    createBody(b.x, b.y, b.z || 0, b.vx, b.vy, b.vz || 0, b.m || 1.0),
  );
  stabilityStatus = "BOUNDED";
  updateHUD();
}

function setChaosMode() {
  clearScene();
  simMode = "CHAOS (RANDOM)";
  physicsSubsteps = 10;
  presetTimeScale = 1.0;
  cameraLocked = false;
  currentSoftening = 0.15;
  useRepulsion = true; // SAFE MODE
  for (let i = 0; i < 3; i++) {
    const m = 0.2 + Math.random() * 12.0;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = Math.cbrt(Math.random()) * 2.5;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const vx = (Math.random() - 0.5) * 0.5;
    const vy = (Math.random() - 0.5) * 0.5;
    const vz = (Math.random() - 0.5) * 0.5;
    createBody(x, y, z, vx, vy, vz, m);
  }
  updateHUD();
}

function addRandomBody() {
  if (bodies.length >= MAX_BODIES) return;
  if (!simMode.includes("CHAOS")) {
    simMode = "CUSTOM CHAOS";
    if (physicsSubsteps > 20) physicsSubsteps = 20;
    // Switch to safe physics if user starts adding bodies
    currentSoftening = 0.15;
    useRepulsion = true;
  }
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.cbrt(Math.random()) * 2.5;
  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta);
  const z = r * Math.cos(phi);
  const vx = (Math.random() - 0.5) * 0.5;
  const vy = (Math.random() - 0.5) * 0.5;
  const vz = (Math.random() - 0.5) * 0.5;
  const m = 0.2 + Math.random() * 8.0;
  createBody(x, y, z, vx, vy, vz, m);
}

const accBuffer = new Float32Array(MAX_BODIES * 3);
function computeAccelerations() {
  accBuffer.fill(0);
  const n = bodies.length;
  const removals = new Set();
  for (let i = 0; i < n; i++) {
    if (removals.has(i)) continue;
    const b1 = bodies[i];
    for (let j = i + 1; j < n; j++) {
      if (removals.has(j)) continue;
      const b2 = bodies[j];
      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;
      const dz = b2.z - b1.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq);
      const r1 = 0.08 * Math.sqrt(b1.mass);
      const r2 = 0.08 * Math.sqrt(b2.mass);
      if (enableMerge && dist < (r1 + r2) * 0.8) {
        const totalMass = b1.mass + b2.mass;
        b1.vx = (b1.vx * b1.mass + b2.vx * b2.mass) / totalMass;
        b1.vy = (b1.vy * b1.mass + b2.vy * b2.mass) / totalMass;
        b1.vz = (b1.vz * b1.mass + b2.vz * b2.mass) / totalMass;
        b1.x = (b1.x * b1.mass + b2.x * b2.mass) / totalMass;
        b1.y = (b1.y * b1.mass + b2.y * b2.mass) / totalMass;
        b1.z = (b1.z * b1.mass + b2.z * b2.mass) / totalMass;
        b1.mass = totalMass;
        let newRad =
          totalMass > 4000
            ? Math.max(
                0.5,
                0.08 * Math.sqrt(4000) * (1000 / (1000 + (totalMass - 4000))),
              )
            : 0.08 * Math.sqrt(totalMass);
        b1.mesh.scale.setScalar(newRad / 0.08);
        if (totalMass > 4000) b1.ring.scale.setScalar(newRad / 0.08);
        const newCol = getStarColor(totalMass);
        b1.mesh.material.color.setHex(newCol);
        const trailColor = totalMass > 4000 ? 0xffffff : newCol;
        b1.trail.material.color.setHex(trailColor);
        b1.arrow.setColor(new THREE.Color(newCol));
        createExplosion(b1.x, b1.y, b1.z, b1.mesh.material.color);
        removals.add(j);
        collisionCount++;
        continue;
      }
      let f;
      if (useRepulsion && dist < 0.2) f = -10.0;
      else f = G / Math.pow(distSq + currentSoftening * currentSoftening, 1.5);

      const fx = f * dx;
      const fy = f * dy;
      const fz = f * dz;
      accBuffer[i * 3 + 0] += fx * b2.mass;
      accBuffer[i * 3 + 1] += fy * b2.mass;
      accBuffer[i * 3 + 2] += fz * b2.mass;
      accBuffer[j * 3 + 0] -= fx * b1.mass;
      accBuffer[j * 3 + 1] -= fy * b1.mass;
      accBuffer[j * 3 + 2] -= fz * b1.mass;
    }
  }
  return removals;
}

function runPhysicsStep(dt) {
  if (bodies.length === 0) return;
  const removals = computeAccelerations();
  if (removals.size > 0) {
    const sorted = Array.from(removals).sort((a, b) => b - a);
    for (let idx of sorted) {
      const b = bodies[idx];
      if (lockedBody === b) {
        lockedBody = null;
        cameraLocked = false;
      }
      scene.remove(b.mesh);
      scene.remove(b.trail);
      scene.remove(b.arrow);
      if (b.ring) scene.remove(b.ring);
      b.mesh.geometry.dispose();
      b.trail.geometry.dispose();
      if (b.arrow) b.arrow.dispose();
      if (b.ring) {
        b.ring.geometry.dispose();
        b.ring.material.dispose();
      }
      bodies.splice(idx, 1);
    }
    updateHUD();
  }
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.vx += accBuffer[i * 3] * 0.5 * dt;
    b.vy += accBuffer[i * 3 + 1] * 0.5 * dt;
    b.vz += accBuffer[i * 3 + 2] * 0.5 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }
  computeAccelerations();
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.vx += accBuffer[i * 3] * 0.5 * dt;
    b.vy += accBuffer[i * 3 + 1] * 0.5 * dt;
    b.vz += accBuffer[i * 3 + 2] * 0.5 * dt;
  }
}

function updateVisuals() {
  let lineIdx = 0;
  const linePos = linkMesh.geometry.attributes.position.array;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.mesh.position.set(b.x, b.y, b.z);
    if (b.ring) {
      b.ring.position.set(b.x, b.y, b.z);
      if (b.mass > 4000) {
        b.ring.material.opacity = 0.8;
        b.ring.lookAt(camera.position);
      } else {
        b.ring.material.opacity = 0.0;
      }
    }
    if (showWeb) {
      for (let j = i + 1; j < bodies.length; j++) {
        const b2 = bodies[j];
        const distSq =
          (b.x - b2.x) ** 2 + (b.y - b2.y) ** 2 + (b.z - b2.z) ** 2;
        if (distSq < LINK_THRESHOLD * LINK_THRESHOLD) {
          linePos[lineIdx++] = b.x;
          linePos[lineIdx++] = b.y;
          linePos[lineIdx++] = b.z;
          linePos[lineIdx++] = b2.x;
          linePos[lineIdx++] = b2.y;
          linePos[lineIdx++] = b2.z;
        }
      }
    }
    if (showVectors) {
      b.arrow.visible = true;
      const vLen = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
      if (vLen > 0.001) {
        b.arrow.position.set(b.x, b.y, b.z);
        b.arrow.setDirection(new THREE.Vector3(b.vx, b.vy, b.vz).normalize());
        b.arrow.setLength(vLen * 0.3, 0.15, 0.08);
      }
    } else {
      b.arrow.visible = false;
    }
    if (!paused) {
      if (!traceMode) {
        b.history = [];
        b.trail.geometry.setDrawRange(0, 0);
      } else if (b.history.length < MAX_TRAIL) {
        b.history.push(b.x, b.y, b.z);
        const pos = b.trail.geometry.attributes.position.array;
        for (let k = 0; k < b.history.length; k++) pos[k] = b.history[k];
        b.trail.geometry.setDrawRange(0, b.history.length / 3);
        b.trail.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
  linkMesh.geometry.setDrawRange(0, lineIdx / 3);
  linkMesh.geometry.attributes.position.needsUpdate = true;
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    ex.age += 1;
    const positions = ex.mesh.geometry.attributes.position.array;
    for (let j = 0; j < ex.vels.length; j++) {
      positions[j * 3] += ex.vels[j].x;
      positions[j * 3 + 1] += ex.vels[j].y;
      positions[j * 3 + 2] += ex.vels[j].z;
    }
    ex.mesh.geometry.attributes.position.needsUpdate = true;
    ex.mesh.material.opacity = 1.0 - ex.age / 60;
    if (ex.age > 60) {
      scene.remove(ex.mesh);
      ex.mesh.geometry.dispose();
      ex.mesh.material.dispose();
      explosions.splice(i, 1);
    }
  }
  nebulaGroup.children.forEach((cloud) => {
    cloud.material.rotation += cloud.userData.rotSpeed;
  });
  if (bodies.length > 0 && cameraLocked && lockedBody) {
    const currentTargetPos = new THREE.Vector3(
      lockedBody.x,
      lockedBody.y,
      lockedBody.z,
    );
    if (!controls.target.equals(currentTargetPos)) {
      const delta = new THREE.Vector3().subVectors(
        currentTargetPos,
        controls.target,
      );
      camera.position.add(delta);
      controls.target.copy(currentTargetPos);
    }
  }
  if (!paused) {
    stabilityStatus = checkStability();
    updateHUD();
  }
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,
    0.4,
    0.6,
  ),
);
function animate() {
  requestAnimationFrame(animate);
  if (!paused) {
    const totalDT = DT * presetTimeScale * userTimeScale;
    simTime += totalDT; // Increment Sim Time
    const stepDt = totalDT / physicsSubsteps;
    for (let i = 0; i < physicsSubsteps; i++) runPhysicsStep(stepDt);
  }
  updateVisuals();
  controls.update();
  composer.render();
}

// INIT SEQUENCE
loadPreset("figure8");
updateHUD();
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
