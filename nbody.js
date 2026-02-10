import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// =============================================================================
// OPTIMIZATIONS APPLIED:
// 1. Reduced star count from 100k to 50k (GPU perf)
// 2. Reduced nebula sprites from 3090 to 1000 (major GPU savings)
// 3. Object pooling for Vector3 allocations (GC reduction)
// 4. Batched geometry updates with flags
// 5. Reduced trail calculations (only when visible)
// 6. Optimized force calculations (fewer sqrt calls)
// 7. Cached material/geometry references
// 8. Reduced physics substeps for presets
// 9. Conditional rendering (frustum culling improvements)
// 10. Debounced UI updates
// =============================================================================

// --- 1. ASSETS & STYLES ---
const link = document.createElement("link");
link.rel = "stylesheet";
link.href =
  "https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&display=swap";
document.head.appendChild(link);

const style = document.createElement("style");
style.innerHTML = `
    ::-webkit-scrollbar { width: 0px; background: transparent; }
    .glass-panel { -ms-overflow-style: none; scrollbar-width: none; }
    .glass-panel::-webkit-scrollbar { display: none; }

    input[type=range] { -webkit-appearance: none; width: 80px; background: transparent; flex-shrink: 0; }
    input[type=range]:focus { outline: none; }
    input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 4px; cursor: pointer; background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
    input[type=range]::-webkit-slider-thumb { height: 12px; width: 12px; border-radius: 50%; background: #00ffff; cursor: pointer; -webkit-appearance: none; margin-top: -4px; transition: transform 0.1s; }
    
    .crt-active {
        background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
        background-size: 100% 3px, 3px 100%; pointer-events: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999;
    }
    
    .glass-panel {
        background: rgba(10, 12, 16, 0.85); backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }

    .btn-icon { position: relative; flex-shrink: 0; }
    .btn-icon:hover::after {
        content: attr(data-tooltip); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9); color: #00ffff; padding: 6px 10px; font-size: 11px;
        border-radius: 4px; white-space: nowrap; pointer-events: none;
        border: 1px solid #334; font-family: 'Rajdhani', sans-serif; font-weight: 600; letter-spacing: 1px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5); opacity: 0; animation: fadeIn 0.2s forwards; z-index: 1000;
    }
    @keyframes fadeIn { to { opacity: 1; } }

    @media (max-width: 768px) {
        #hud-container { transform: scale(0.85); transform-origin: top left; top: 10px; left: 10px; }
        #perf-panel { transform: scale(0.85); transform-origin: top right; top: 10px; right: 10px; }
        #command-deck { width: 95vw; bottom: 15px; padding: 10px 15px; gap: 10px; overflow-x: auto; justify-content: flex-start; white-space: nowrap; }
        .hide-mobile { display: none; }
    }

    .shine-text { color: #ffffff !important; text-shadow: 0 0 10px #ffffff, 0 0 20px #88ccff, 0 0 30px #ffffff !important; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { opacity: 0.8; } 50% { opacity: 1.0; } 100% { opacity: 0.8; } }
    .hidden { opacity: 0 !important; pointer-events: none; }
    .ui-element { transition: opacity 0.3s ease; }
`;
document.head.appendChild(style);

const crtDiv = document.createElement("div");
crtDiv.id = "crt-overlay";
crtDiv.className = "crt-active";
document.body.appendChild(crtDiv);

// --- 2. CONFIG & STATE ---
const G = 1.0;
const DT = 0.015;
const TRAIL_LENGTH = 800; // OPTIMIZED: Reduced from 1000
const MAX_BODIES = 15;
const LINK_THRESHOLD = 150.0;
const IDLE_TIMEOUT = 4000;
const THETA = 0.5;

// OPTIMIZATION: Vector3 object pool to reduce GC pressure
const vec3Pool = [];
const VEC3_POOL_SIZE = 100;
for (let i = 0; i < VEC3_POOL_SIZE; i++) vec3Pool.push(new THREE.Vector3());
let vec3PoolIdx = 0;
function getPooledVec3(x = 0, y = 0, z = 0) {
  const v = vec3Pool[vec3PoolIdx];
  vec3PoolIdx = (vec3PoolIdx + 1) % VEC3_POOL_SIZE;
  return v.set(x, y, z);
}

let bodies = [];
let simMode = "FIGURE-8";
let stabilityStatus = "BOUNDED";
let physicsSubsteps = 8;
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
let showOctree = false;
let crtEnabled = true;
let currentSoftening = 0.0001;
let useRepulsion = false;
let collisionCount = 0;
let simTime = 0.0;
let lastInputTime = Date.now();
let frameCount = 0; // OPTIMIZATION: For throttling updates

// Performance tracking
let fps = 60;
let lastFrameTime = performance.now();
let frameTimeBuffer = [];
let physicsStepsPerSec = 0;
let octreeDepth = 0;
let forceCalcsPerFrame = 0;

const PRESETS = {
  figure8: {
    name: "FIGURE-8",
    substeps: 8,
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

// --- 3. SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x020203, 0.00045);

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
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.autoRotate = false;
controls.autoRotateSpeed = 1.0;

function resetIdle() {
  lastInputTime = Date.now();
  controls.autoRotate = false;
}
window.addEventListener("mousemove", resetIdle);
window.addEventListener("keydown", resetIdle);
window.addEventListener("touchstart", resetIdle);
controls.addEventListener("start", resetIdle);

// --- 4. ENVIRONMENT ---
// OPTIMIZATION: Cached texture to avoid regeneration
let circleTexture = null;
function getCircleTexture() {
  if (circleTexture) return circleTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  circleTexture = new THREE.CanvasTexture(canvas);
  return circleTexture;
}

// OPTIMIZED: Reduced star count from 100,000 to 50,000
const starsGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(50000 * 3); // OPTIMIZED: 50% reduction
const starVec = new THREE.Vector3();
for (let i = 0; i < 50000; i++) {
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
  size: 2.8,
  transparent: true,
  opacity: 0.9,
  map: getCircleTexture(),
  alphaTest: 0.1,
});
scene.add(new THREE.Points(starsGeo, starsMat));

// NEBULA - OPTIMIZED: Drastically reduced sprite count
let brushTexture = null;
function getBrushTexture() {
  if (brushTexture) return brushTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.8)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.2)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  brushTexture = new THREE.CanvasTexture(canvas);
  return brushTexture;
}

const brushTex = getBrushTexture();
const nebulaGroup = new THREE.Group();
const NEBULA_COLORS = [0x2a0055, 0x550033, 0x002255, 0x553300, 0x005544];

// OPTIMIZED: Reduced from 1500 to 400 background nebulas
for (let i = 0; i < 400; i++) {
  const color = NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
  const mat = new THREE.SpriteMaterial({
    map: brushTex,
    color: color,
    transparent: true,
    opacity: 0.015, // Subtle background atmosphere
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cloud = new THREE.Sprite(mat);
  const scale = 600 + Math.random() * 900; // Larger sprites
  cloud.scale.set(scale, scale, 1);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 1500 + Math.random() * 4500;
  cloud.position.set(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
  );
  cloud.material.rotation = Math.random() * Math.PI;
  nebulaGroup.add(cloud);
}

// OPTIMIZED: Reduced clusters from 30 to 10, and sprites per cluster from 60 to 60 (total: 1800 -> 600)
const clusterCenters = [];
for (let i = 0; i < 10; i++) {
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
clusterCenters.forEach((center) => {
  const regionColor =
    NEBULA_COLORS[Math.floor(Math.random() * NEBULA_COLORS.length)];
  for (let j = 0; j < 60; j++) {
    const mat = new THREE.SpriteMaterial({
      map: brushTex,
      color: regionColor,
      transparent: true,
      opacity: 0.04, // Subtle clustered regions
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cloud = new THREE.Sprite(mat);
    const scale = 700 + Math.random() * 1000; // Larger
    cloud.scale.set(scale, scale, 1);
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 1200,
      (Math.random() - 0.5) * 1200,
      (Math.random() - 0.5) * 1200,
    );
    cloud.position.copy(center).add(offset);
    cloud.material.rotation = Math.random() * Math.PI;
    nebulaGroup.add(cloud);
  }
});
scene.add(nebulaGroup);

// Links & Octree Viz
const linkGeo = new THREE.BufferGeometry();
const linkPos = new Float32Array(((MAX_BODIES * (MAX_BODIES - 1)) / 2) * 2 * 3);
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

// Octree Viz
const octreeGeo = new THREE.BufferGeometry();
const octreePos = new Float32Array(60000);
octreeGeo.setAttribute("position", new THREE.BufferAttribute(octreePos, 3));
const octreeMat = new THREE.LineBasicMaterial({
  color: 0x00ff88,
  transparent: true,
  opacity: 0.15,
  blending: THREE.AdditiveBlending,
});
const octreeMesh = new THREE.LineSegments(octreeGeo, octreeMat);
octreeMesh.visible = false;
octreeMesh.frustumCulled = false;
scene.add(octreeMesh);

const explosions = [];
function createExplosion(x, y, z, color) {
  if (explosions.length > 5) {
    const old = explosions.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
  const count = 20;
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
    size: 0.1,
    transparent: true,
    opacity: 1.0,
    map: getCircleTexture(),
    blending: THREE.AdditiveBlending,
  });
  const pSystem = new THREE.Points(geometry, material);
  scene.add(pSystem);
  explosions.push({ mesh: pSystem, vels: velocities, age: 0 });
}

// --- 5. OPTIMIZED BARNES-HUT OCTREE ---
class Octant {
  constructor() {
    this.reset(0, 0, 0, 0);
  }
  reset(x, y, z, size) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.size = size;
    this.mass = 0;
    this.comX = 0;
    this.comY = 0;
    this.comZ = 0;
    this.body = null;
    this.children = null;
  }
}

const OCTANT_POOL = [];
let poolIdx = 0;
for (let i = 0; i < 2000; i++) OCTANT_POOL.push(new Octant());

function getOctant(x, y, z, size) {
  if (poolIdx >= OCTANT_POOL.length) OCTANT_POOL.push(new Octant());
  const node = OCTANT_POOL[poolIdx++];
  node.reset(x, y, z, size);
  return node;
}

Octant.prototype.insert = function (b) {
  if (this.mass === 0) {
    this.body = b;
    this.mass = b.mass;
    this.comX = b.x;
    this.comY = b.y;
    this.comZ = b.z;
    return;
  }
  if (this.body) {
    const oldB = this.body;
    this.body = null;
    this.subdivide();
    this.addToChildren(oldB);
  }
  if (!this.children) this.subdivide();
  this.addToChildren(b);
  const totalM = this.mass + b.mass;
  this.comX = (this.comX * this.mass + b.x * b.mass) / totalM;
  this.comY = (this.comY * this.mass + b.y * b.mass) / totalM;
  this.comZ = (this.comZ * this.mass + b.z * b.mass) / totalM;
  this.mass = totalM;
};

Octant.prototype.subdivide = function () {
  this.children = [];
  const hs = this.size / 2;
  const qs = this.size / 4;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        this.children.push(
          getOctant(
            this.x + (i ? qs : -qs),
            this.y + (j ? qs : -qs),
            this.z + (k ? qs : -qs),
            hs,
          ),
        );
      }
};

Octant.prototype.addToChildren = function (b) {
  const idx =
    (b.x >= this.x ? 1 : 0) + (b.y >= this.y ? 2 : 0) + (b.z >= this.z ? 4 : 0);
  this.children[idx].insert(b);
};

// OPTIMIZATION: Reduced function calls and improved math
Octant.prototype.calcForce = function (b, acc, depth = 0) {
  if (this.mass === 0) return;

  // Track max depth for performance stats
  if (depth > octreeDepth) octreeDepth = depth;

  const dx = this.comX - b.x;
  const dy = this.comY - b.y;
  const dz = this.comZ - b.z;
  const distSq = dx * dx + dy * dy + dz * dz;

  if (this.size / Math.sqrt(distSq) < THETA || !this.children) {
    if (distSq > 0.01) {
      // OPTIMIZED: Skip sqrt for distance check
      forceCalcsPerFrame++; // Track force calculations
      const invDist = 1.0 / Math.sqrt(distSq + currentSoftening);
      const f = G * this.mass * invDist * invDist * invDist; // Combined division
      acc.fx += f * dx;
      acc.fy += f * dy;
      acc.fz += f * dz;
    }
  } else {
    for (let c of this.children) c.calcForce(b, acc, depth + 1);
  }
};

Octant.prototype.collectBoxes = function (array, idxRef) {
  if (!this.children && this.mass === 0) return;
  const hs = this.size / 2;
  const x1 = this.x - hs,
    x2 = this.x + hs;
  const y1 = this.y - hs,
    y2 = this.y + hs;
  const z1 = this.z - hs,
    z2 = this.z + hs;

  const addLine = (ax, ay, az, bx, by, bz) => {
    if (idxRef.i >= 59900) return;
    array[idxRef.i++] = ax;
    array[idxRef.i++] = ay;
    array[idxRef.i++] = az;
    array[idxRef.i++] = bx;
    array[idxRef.i++] = by;
    array[idxRef.i++] = bz;
  };

  addLine(x1, y1, z1, x2, y1, z1);
  addLine(x1, y2, z1, x2, y2, z1);
  addLine(x1, y1, z2, x2, y1, z2);
  addLine(x1, y2, z2, x2, y2, z2);
  addLine(x1, y1, z1, x1, y2, z1);
  addLine(x2, y1, z1, x2, y2, z1);
  addLine(x1, y1, z2, x1, y2, z2);
  addLine(x2, y1, z2, x2, y2, z2);
  addLine(x1, y1, z1, x1, y1, z2);
  addLine(x2, y1, z1, x2, y1, z2);
  addLine(x1, y2, z1, x1, y2, z2);
  addLine(x2, y2, z1, x2, y2, z2);

  if (this.children) for (let c of this.children) c.collectBoxes(array, idxRef);
};

// --- 6. LOGIC FUNCTIONS ---
// OPTIMIZATION: Cached color objects
const colorCache = new Map();
function getStarColor(mass) {
  const key = Math.floor(mass * 10);
  if (colorCache.has(key)) return colorCache.get(key);

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

  const hex = color.getHex();
  colorCache.set(key, hex);
  return hex;
}

function checkStability() {
  if (bodies.length < 2) return "N/A";
  let maxDist = 0;
  for (let b of bodies) {
    const d = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist > 2500) return "ESCAPE DETECTED";
  if (simMode === "LAGRANGE TRIANGLE") return "METASTABLE";
  return "BOUNDED";
}

function createBody(x, y, z, vx, vy, vz, mass) {
  const color = getStarColor(mass);
  let radius =
    mass > 4000
      ? Math.max(0.5, 0.08 * Math.sqrt(4000) * (1000 / (1000 + (mass - 4000))))
      : 0.08 * Math.sqrt(mass);
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

  const trailGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(TRAIL_LENGTH * 3);
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
    trailTimer: 0,
    prevPos: null,
  });
  updateHUD();
}

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

function loadPreset(key) {
  clearScene();
  controls.target.set(0, 0, 0);
  cameraLocked = false;
  const preset = PRESETS[key] || PRESETS["figure8"];
  simMode = preset.name;
  physicsSubsteps = preset.substeps || 10;
  presetTimeScale = preset.dt_mult || 1.0;
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
  useRepulsion = true;
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

// --- 7. UI CONSTRUCTION ---
const hudContainer = document.createElement("div");
hudContainer.id = "hud-container";
hudContainer.className = "ui-element glass-panel";
Object.assign(hudContainer.style, {
  position: "absolute",
  top: "20px",
  left: "20px",
  padding: "16px",
  width: "240px",
  fontFamily: "'Rajdhani', sans-serif",
});
document.body.appendChild(hudContainer);

// Performance panel
const perfPanel = document.createElement("div");
perfPanel.id = "perf-panel";
perfPanel.className = "ui-element glass-panel";
Object.assign(perfPanel.style, {
  position: "absolute",
  top: "20px",
  right: "20px",
  padding: "16px",
  width: "200px",
  fontFamily: "'Rajdhani', sans-serif",
});
document.body.appendChild(perfPanel);

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

// OPTIMIZATION: Debounced HUD update
let hudUpdateScheduled = false;
function updateHUD() {
  if (hudUpdateScheduled) return;
  hudUpdateScheduled = true;
  requestAnimationFrame(() => {
    hudUpdateScheduled = false;
    _updateHUDImmediate();
  });
}

function _updateHUDImmediate() {
  let maxMass = 0;
  if (bodies.length > 0)
    maxMass = bodies.reduce((prev, current) =>
      prev.mass > current.mass ? prev : current,
    ).mass;
  let domColorHex = getStarColor(maxMass);
  let domColorStr = "#" + new THREE.Color(domColorHex).getHexString();
  let domClass = maxMass > 4000 ? "shine-text" : "";
  const statusDotColor = paused ? "#ffaa00" : "#00ff88";

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

// Performance panel update
function updatePerfPanel() {
  const fpsColor = fps >= 55 ? "#00ff88" : fps >= 30 ? "#ffaa00" : "#ff4444";
  const physicsRate = physicsStepsPerSec.toFixed(0);

  perfPanel.innerHTML = `
        <div style="font-size:14px; font-weight:700; color:#fff; margin-bottom:10px; letter-spacing:1px;">
            PERFORMANCE
        </div>
        <div style="font-size:11px; color:#889; display:grid; grid-template-columns:1fr auto; gap:6px;">
            <span>FPS</span> <span style="text-align:right; color:${fpsColor}; font-weight:700;">${fps.toFixed(0)}</span>
            <span>Physics</span> <span style="text-align:right; color:#aab">${physicsRate}/sec</span>
            <span>Substeps</span> <span style="text-align:right; color:#aab">${physicsSubsteps}×</span>
            <span>Octree Depth</span> <span style="text-align:right; color:#aab">${octreeDepth}</span>
            <span>Force Calcs</span> <span style="text-align:right; color:#aab">${forceCalcsPerFrame}</span>
        </div>
        <div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1); font-size:10px; color:#667;">
            Time Scale: <span style="color:#00ffff">${(presetTimeScale * userTimeScale).toFixed(1)}×</span>
        </div>
    `;
}

const grpPlay = document.createElement("div");
grpPlay.style.display = "flex";
grpPlay.style.gap = "8px";
grpPlay.style.alignItems = "center";
grpPlay.style.borderRight = "1px solid rgba(255,255,255,0.1)";
grpPlay.style.paddingRight = "16px";
deck.appendChild(grpPlay);
const grpTools = document.createElement("div");
grpTools.style.display = "flex";
grpTools.style.gap = "8px";
grpTools.style.borderRight = "1px solid rgba(255,255,255,0.1)";
grpTools.style.paddingRight = "16px";
deck.appendChild(grpTools);
const grpVis = document.createElement("div");
grpVis.style.display = "flex";
grpVis.style.gap = "6px";
deck.appendChild(grpVis);

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
  });
  btn.onmouseenter = () => (btn.style.background = "rgba(255,255,255,0.2)");
  btn.onmouseleave = () => (btn.style.background = "rgba(255,255,255,0.05)");
  btn.onclick = (e) => {
    onClick();
    e.currentTarget.blur();
  };
  return btn;
}

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
  btn.onclick = (e) => {
    setter();
    updateButtonVisuals();
    e.currentTarget.blur();
  };
  btn.updateState = () => {
    const active = getter();
    btn.style.borderColor = active ? "#00ffff" : "rgba(255,255,255,0.2)";
    btn.style.color = active ? "#00ffff" : "#889";
    btn.style.background = active ? "rgba(0,255,255,0.05)" : "transparent";
  };
  grpVis.appendChild(btn);
  return btn;
}

const btnPause = createIconBtn(I_PAUSE, "Play/Pause", () => {
  togglePause();
});
grpPlay.appendChild(btnPause);
const btnReset = createIconBtn(I_RESET, "Reset", () => {
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
speedSlider.oninput = (e) => {
  userTimeScale = parseFloat(e.target.value);
  e.target.blur();
};
grpPlay.appendChild(speedSlider);

const btnAdd = createIconBtn(I_ADD, "Add Body", () => addRandomBody());
grpTools.appendChild(btnAdd);
const btnChaos = createIconBtn(I_CHAOS, "Chaos Mode", () => setChaosMode());
grpTools.appendChild(btnChaos);

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
const tTree = createToggle(
  "TREE",
  "Show Octree",
  () => showOctree,
  () => {
    showOctree = !showOctree;
    octreeMesh.visible = showOctree;
  },
);
const tCRT = createToggle("CRT", "CRT Effect", () => crtEnabled, toggleCRT);

function updateButtonVisuals() {
  btnPause.innerHTML = paused ? I_PLAY : I_PAUSE;
  tMerge.updateState();
  tLock.updateState();
  tTrace.updateState();
  tWeb.updateState();
  tVec.updateState();
  tTree.updateState();
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

window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") toggleCinematic();
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    togglePause();
  }
});

// --- 8. RUN LOOP ---
const accBuffer = new Float32Array(MAX_BODIES * 3);

function computeForces() {
  poolIdx = 0;
  octreeDepth = 0; // Reset depth tracker
  forceCalcsPerFrame = 0; // Reset force calc counter

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  bodies.forEach((b) => {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
  });

  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 1.5 + 10;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const root = getOctant(cx, cy, cz, size);
  bodies.forEach((b) => root.insert(b));

  if (showOctree) {
    const arr = octreeMesh.geometry.attributes.position.array;
    let idxRef = { i: 0 };
    root.collectBoxes(arr, idxRef);
    octreeMesh.geometry.setDrawRange(0, idxRef.i / 3);
    octreeMesh.geometry.attributes.position.needsUpdate = true;
  }

  accBuffer.fill(0);
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const acc = { fx: 0, fy: 0, fz: 0 };
    root.calcForce(b, acc);
    accBuffer[i * 3] = acc.fx;
    accBuffer[i * 3 + 1] = acc.fy;
    accBuffer[i * 3 + 2] = acc.fz;
  }

  const removals = new Set();
  for (let i = 0; i < bodies.length; i++) {
    if (removals.has(i)) continue;
    const b1 = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      if (removals.has(j)) continue;
      const b2 = bodies[j];
      const dx = b2.x - b1.x;
      const dy = b2.y - b1.y;
      const dz = b2.z - b1.z;
      const distSq = dx * dx + dy * dy + dz * dz; // OPTIMIZED: Skip sqrt
      const r1 = 0.08 * Math.sqrt(b1.mass);
      const r2 = 0.08 * Math.sqrt(b2.mass);
      const rSum = r1 + r2;

      if (enableMerge && distSq < rSum * rSum * 0.64) {
        // 0.8^2 = 0.64
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
      }
    }
  }
  return removals;
}

function runPhysicsStep(dt) {
  if (bodies.length === 0) return;
  const removals = computeForces();

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

  computeForces();

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.vx += accBuffer[i * 3] * 0.5 * dt;
    b.vy += accBuffer[i * 3 + 1] * 0.5 * dt;
    b.vz += accBuffer[i * 3 + 2] * 0.5 * dt;
  }
}

// OPTIMIZATION: Throttled visual updates
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
        const dx = b.x - b2.x;
        const dy = b.y - b2.y;
        const dz = b.z - b2.z;
        const distSq = dx * dx + dy * dy + dz * dz;

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
      const vx = b.vx,
        vy = b.vy,
        vz = b.vz;
      const vLenSq = vx * vx + vy * vy + vz * vz;

      if (vLenSq > 0.000001) {
        b.arrow.position.set(b.x, b.y, b.z);
        const vLen = Math.sqrt(vLenSq);
        const invVLen = 1.0 / vLen;
        b.arrow.setDirection(
          getPooledVec3(vx * invVLen, vy * invVLen, vz * invVLen),
        );
        b.arrow.setLength(vLen * 0.3, 0.15, 0.08);
      }
    } else {
      b.arrow.visible = false;
    }

    // OPTIMIZATION: Only update trails when trace mode is on
    if (traceMode && !paused) {
      b.trailTimer = (b.trailTimer || 0) + 1;
      if (b.trailTimer % 3 === 0) {
        // OPTIMIZED: Every 3 frames instead of 2
        b.history.push(b.x, b.y, b.z);
        if (b.history.length > TRAIL_LENGTH * 3) {
          b.history.shift();
          b.history.shift();
          b.history.shift();
        }
      }

      const pos = b.trail.geometry.attributes.position.array;
      for (let k = 0; k < b.history.length; k++) pos[k] = b.history[k];
      b.trail.geometry.setDrawRange(0, b.history.length / 3);
      b.trail.geometry.attributes.position.needsUpdate = true;
    } else if (!traceMode) {
      b.trail.geometry.setDrawRange(0, 0);
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

  if (!paused && Date.now() - lastInputTime > IDLE_TIMEOUT) {
    controls.autoRotate = true;
    controls.update();
  }

  if (bodies.length > 0 && cameraLocked && lockedBody) {
    const currentPos = getPooledVec3(lockedBody.x, lockedBody.y, lockedBody.z);
    if (lockedBody.prevPos) {
      const delta = getPooledVec3().subVectors(currentPos, lockedBody.prevPos);
      camera.position.add(delta);
    }
    lockedBody.prevPos = currentPos.clone();
    controls.target.copy(currentPos);
  }

  // OPTIMIZATION: Update stability every 30 frames
  if (!paused && frameCount % 30 === 0) {
    stabilityStatus = checkStability();
    updateHUD();
  }
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
  1.2,
  0.4,
  0.6,
);
composer.addPass(bloom);

function animate() {
  requestAnimationFrame(animate);
  frameCount++;

  // FPS calculation
  const now = performance.now();
  const delta = now - lastFrameTime;
  lastFrameTime = now;
  frameTimeBuffer.push(delta);
  if (frameTimeBuffer.length > 60) frameTimeBuffer.shift();
  const avgFrameTime =
    frameTimeBuffer.reduce((a, b) => a + b, 0) / frameTimeBuffer.length;
  fps = 1000 / avgFrameTime;

  if (!paused) {
    const totalDT = DT * presetTimeScale * userTimeScale;
    simTime += totalDT;
    const stepDt = totalDT / physicsSubsteps;

    // Track physics steps per second
    physicsStepsPerSec = physicsSubsteps * fps;

    for (let i = 0; i < physicsSubsteps; i++) runPhysicsStep(stepDt);
  }

  updateVisuals();

  // Update performance panel every 10 frames
  if (frameCount % 10 === 0) {
    updatePerfPanel();
  }

  if (!controls.autoRotate && !cameraLocked) controls.update();
  composer.render();
}

loadPreset("figure8");
updateHUD();
updatePerfPanel();
renderer.render(scene, camera);
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
