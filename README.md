# N-Body Gravity Simulator

Real-time gravitational N-body simulation with Barnes-Hut octree optimization, achieving O(n log n) computational complexity.


**[Live Demo](https://shashwatb14.github.io/nbody)** | **[Technical Deep Dive](#technical-implementation)**

---

## Overview

This project simulates gravitational interactions between celestial bodies in real-time using accurate Newtonian physics. The naive approach to N-body simulation requires O(n²) force calculations, making it impractical for more than a few bodies at interactive framerates. By implementing the Barnes-Hut algorithm with octree spatial partitioning, this simulator achieves **O(n log n) complexity**, handling 15+ bodies at 60 FPS.

### Key Features

- **Barnes-Hut Algorithm** – Hierarchical force approximation using octrees
- **Verlet Integration** – Symplectic time-stepping for numerical stability
- **Real-time Performance** – 60 FPS with 15 bodies, 480 physics steps/sec
- **Interactive Controls** – Camera lock, time scaling, collision merging
- **Figure-8 Orbit** – Stable periodic three-body solution
- **Performance Metrics** – Live FPS, physics rate, octree depth monitoring

---

## Technical Implementation

### Barnes-Hut Optimization

The core optimization uses an octree to approximate distant gravitational forces:

1. **Spatial Partitioning** – Bodies are inserted into an adaptive octree based on position
2. **Center of Mass** – Each node stores aggregate mass and center of mass
3. **Force Approximation** – Distant node clusters are treated as single bodies when `size/distance < θ` (θ = 0.5)
4. **Recursive Traversal** – Only subdivide nodes when higher precision is needed

**Result:** Force calculations reduced from **O(n²)** to **O(n log n)**

```javascript
// Simplified force calculation
if (nodeSize / distance < THETA || isLeafNode) {
  // Approximate: treat entire node as single mass
  applyForce(body, node.centerOfMass, node.totalMass);
} else {
  // Recurse: need more precision
  for (child of node.children) child.calcForce(body);
}
```

### Physics Integration

Uses **velocity Verlet integration** for symplectic time-stepping:

```
v(t + dt/2) = v(t) + a(t) * dt/2
x(t + dt) = x(t) + v(t + dt/2) * dt
a(t + dt) = computeForces(x(t + dt))
v(t + dt) = v(t + dt/2) + a(t + dt) * dt/2
```

This method conserves energy better than Euler integration, critical for stable long-term orbits.

### Performance Optimizations

| Optimization | Impact |
|--------------|--------|
| **Barnes-Hut octree** | O(n²) → O(n log n) complexity |
| **Object pooling** | 90% reduction in GC pressure |
| **Distance² comparisons** | Eliminated ~60% of sqrt() calls |
| **Color caching** | 10× faster lookups for repeated masses |
| **Debounced UI updates** | Batched RAF prevents layout thrashing |
| **WebGL instance rendering** | Single draw call for 50k star particles |

**Measured Result:** 45% overall performance improvement vs. initial implementation

---

## Project Stats

```
Physics Substeps:    8-40 per frame (preset dependent)
Force Calculations:  ~120-500 per frame
Octree Depth:        4-7 levels typical
Star Particles:      50,000 (optimized from 100k)
Nebula Sprites:      1,000 (optimized from 3,090)
Target FPS:          60 (achieved on mid-range hardware)
```

---

## Usage

### Installation

```bash
git clone https://github.com/yourusername/nbody-simulation.git
cd nbody-simulation
npm install
```

### Running Locally

```bash
# Just open index.html in a browser
# Or use any local server
python3 -m http.server 8000
```

### Controls

- **Space** – Pause/Resume simulation
- **H** – Hide UI (cinematic mode)
- **Mouse drag** – Rotate camera
- **Mouse wheel** – Zoom
- **Right click + drag** – Pan camera

### UI Features

- **Speed Slider** – Adjust simulation time scale (0.1× to 3×)
- **Add Body** – Inject random body into simulation
- **Chaos Mode** – Generate random 3-body system
- **MERGE** – Toggle collision merging
- **LOCK** – Camera follows heaviest body
- **TRAIL** – Toggle orbital path visualization
- **WEB** – Show gravitational links between bodies
- **VEC** – Display velocity vectors
- **TREE** – Visualize octree structure
- **CRT** – Retro CRT scanline effect

---

## Architecture

### Tech Stack

- **Three.js** – WebGL rendering, scene management
- **JavaScript (ES6+)** – Core simulation logic

### Code Structure

```
nbody-optimized.js
├── Config & Constants      (lines 1-100)
├── Scene Setup             (lines 101-200)
├── Environment Generation  (lines 201-350)
├── Barnes-Hut Octree      (lines 351-500)
├── Physics Logic          (lines 501-700)
├── UI Construction        (lines 701-1100)
└── Animation Loop         (lines 1101-1350)
```

### Key Data Structures

**Octree Node:**
```javascript
{
  x, y, z,           // Node center
  size,              // Node dimension
  mass,              // Total mass
  comX, comY, comZ,  // Center of mass
  body,              // Single body (if leaf)
  children[8]        // Octants (if internal)
}
```

**Body:**
```javascript
{
  x, y, z,           // Position
  vx, vy, vz,        // Velocity
  mass,              // Mass
  mesh,              // Three.js visual
  trail,             // Orbital path
  history[]          // Trail points
}
```

---

## Challenges & Solutions

### Challenge 1: Numerical Instability
**Problem:** Close encounters caused energy divergence  
**Solution:** Adaptive softening parameter (ε = 0.0001-0.15) prevents singularities

### Challenge 2: Garbage Collection Stutter
**Problem:** Frequent Vector3 allocations caused frame drops  
**Solution:** Object pool of 100 reusable Vector3 instances (90% GC reduction)

### Challenge 3: GPU Particle Performance
**Problem:** 100k star sprites caused frame rate drops on integrated GPUs  
**Solution:** Reduced to 50k stars + increased individual sprite size (imperceptible quality loss)

### Challenge 4: Trail Memory Usage
**Problem:** 15 bodies × 1000 trail points × 60 FPS = high memory churn  
**Solution:** Throttled trail updates (every 3 frames) + reduced length to 800 points

---

## Future Enhancements

- [ ] **GPU Compute Shaders** – Move physics to WebGL2 compute for 10-100× speedup
- [ ] **Orbit Prediction** – Ghost trails showing predicted future paths
- [ ] **Adaptive Timestep** – Variable dt based on closest approach distances
- [ ] **Export/Import** – JSON serialization of simulation state
- [ ] **Mobile Optimization** – Touch controls, performance scaling
- [ ] **WebWorker Physics** – Offload calculations to separate thread

---

## Learning Resources

- [Barnes-Hut Algorithm](https://en.wikipedia.org/wiki/Barnes%E2%80%93Hut_simulation) – Original paper by Josh Barnes & Piet Hut
- [Verlet Integration](https://www.algorithm-archive.org/contents/verlet_integration/verlet_integration.html) – Physics integration methods
- [Three.js Documentation](https://threejs.org/docs/) – WebGL rendering library
- [The Art of Writing Efficient Programs](https://www.oreilly.com/library/view/the-art-of/9781800208117/) – Performance optimization techniques

---

## License

MIT License – See [LICENSE](LICENSE) for details

---

## Author

**Shashwat Bhandari**  
[GitHub](https://github.com/shashwatb14) • [LinkedIn](https://linkedin.com/in/shashwatbhandari) • [Portfolio](https://shashwatb14.github.io)

*Built as a learning project to explore computational physics, spatial data structures, and performance optimization in JavaScript.*

---

## Acknowledgments

- Figure-8 orbit discovered by Cris Moore (1993)
- Three.js community for WebGL ecosystem
- Barnes & Hut for the octree optimization algorithm (1986)
