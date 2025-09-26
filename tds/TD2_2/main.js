const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true });
engine.displayLoadingUI();

/* =================== Utilidades =================== */
function getBounds(root) {
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const size = max.subtract(min);
  const center = min.add(size.scale(0.5));
  return { size, center, min, max };
}

function normalizeUnderPivot(importResult, scene, {
  targetSize,
  groundAlign = false,
  receiveShadows = true
}) {
  const pivot = new BABYLON.TransformNode(`${importResult.meshes[0].name}_pivot`, scene);
  importResult.meshes.forEach(m => m.setParent(pivot));

  const { center } = getBounds(pivot);
  pivot.getChildMeshes().forEach(m => m.position.subtractInPlace(center));

  const bounds = getBounds(pivot);
  const largest = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);
  const scale = targetSize / (largest || 1);
  pivot.scaling = new BABYLON.Vector3(scale, scale, scale);

  if (groundAlign) {
    const { min: minAfter } = getBounds(pivot);
    pivot.position.y -= minAfter.y;
  }

  // sombras
  pivot.getChildMeshes().forEach(m => (m.receiveShadows = receiveShadows));

  const { size: finalSize } = getBounds(pivot);
  return { pivot, finalSize };
}

async function importSafe(rootUrl, fileName, name, scene) {
  try {
    const res = await BABYLON.SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene);
    return res;
  } catch (e) {
    console.error(`Error cargando ${name} (${fileName})`, e);
    throw e;
  }
}

// PBR visible con IBL + luces (sin tocar emissive)
function makePBRVisible(importResult) {
  importResult.meshes.forEach(m => {
    const mat = m.material;
    if (!mat || !mat.getClassName) return;
    if (mat.getClassName() === "PBRMaterial") {
      mat.disableLighting = false;
      mat.backFaceCulling = false;
      if (mat.metallic !== undefined)  mat.metallic  = Math.min(mat.metallic, 0.9);
      if (mat.roughness !== undefined) mat.roughness = Math.max(mat.roughness, 0.15);
    }
  });
}

// vector unitario aleatorio (superficie de la esfera)
function randomUnitVector() {
  let u = 0, v = 0, s = 2;
  while (s >= 1 || s === 0) {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u*u + v*v;
  }
  const factor = Math.sqrt(1 - s);
  const x = 2*u*factor;
  const y = 1 - 2*s;
  const z = 2*v*factor;
  return new BABYLON.Vector3(x, y, z);
}

/* =================== Textura (Base64) ===================
   Solo normal map para micro detalle de agua (sin albedo). */
const WATER_NORMAL_DATAURL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABvNw1mAAAACXBIWXMAAAsSAAALEgHS3X78AAABc0lEQVR4nO3asW7CMBRG4W9xqfQm0Zs2a9bQZ6q8i7c2pQ3q0m5eQyqJm8QzP8mJw1cU8mNn2mA1p1Qxk7y0vQd7cQnqJkS9W1Vf7+4yqf3b6C6iYmJiYmJiYmJi4j8n8y8f2C0JjQ1z7bR7xB2o7xGd1y0m2v0bqv4y3j6V1O5w3G7b9V2m7r4Qx8z9gk9Qb9b8b9c8o9Yb9b8b9c8o9Yb9b8b9c8o9Yb9b8b9c8o9YfQJuvmJj5uXh4eHh4ePh0Gq1Go3G43G43G41Go1Go1Gg3H4+Hk8nl8XjcbjcblcrlcplUpVKpVqtVoPB4PB6PRaPRaDQaDAb9J0YQyJiYmJiYmJiYmJj8n+3+G5bLfB8AAAAASUVORK5CYII=";

/* =================== Océano low-poly (Gerstner + boyancia) =================== */
function createLowPolyOcean(scene, {
  size = 16000,          // lado del plano
  subdivisions = 160,    // resolución
  levelY = -600,         // altura Y del océano
  amplitude = 20,        // altura típica de ola
  choppiness = 0.9,      // “picos”
  windDirs = [
    new BABYLON.Vector2(1.0, 0.2),
    new BABYLON.Vector2(0.5, 0.85),
    new BABYLON.Vector2(-0.4, 0.9)
  ],
  wavelengths = [300, 600, 1100],
  speeds = [12, 9, 6]
} = {}) {

  // --- Material PBR de agua (azul) ---
  const normalTex = new BABYLON.Texture(WATER_NORMAL_DATAURL, scene, true, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  normalTex.uScale = normalTex.vScale = 12;

  const pbr = new BABYLON.PBRMaterial("waterPBR", scene);
  pbr.albedoTexture = null;
  pbr.albedoColor = new BABYLON.Color3(0.10, 0.45, 0.85); // azul agua
  pbr.bumpTexture = normalTex;

  pbr.metallic = 0.0;
  pbr.roughness = 0.35;          // brillo leve
  pbr.alpha = 0.98;
  pbr.backFaceCulling = false;
  pbr.twoSidedLighting = true;
  pbr.useAlphaFromAlbedoTexture = false;

  // Malla base
  const ground = BABYLON.MeshBuilder.CreateGround("ocean", {
    width: size,
    height: size,
    subdivisions: subdivisions,
    updatable: true
  }, scene);
  ground.material = pbr;
  ground.position.y = levelY;
  ground.receiveShadows = false;
  ground.isPickable = false;

  // Low-poly look: faceteado
  ground.convertToFlatShadedMesh();

  const positions = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const basePositions = positions.slice();

  // === Gerstner Waves ===
  const TWO_PI = Math.PI * 2;
  const dirs = windDirs.map(v => v.normalize());
  const ks = wavelengths.map(L => TWO_PI / L);
  const amps = wavelengths.map((L, i) => amplitude * (1 - i * 0.2));
  const omegas = wavelengths.map((L, i) => Math.sqrt(9.81 * ks[i]));

  const floaters = []; // { node, radius, velY }
  function addFloater(node, radius = 50) { floaters.push({ node, radius, velY: 0 }); }
  window.oceanAddFloater = addFloater;

  function waveXZ(x, z, t) {
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const k = ks[i];
      const A = amps[i];
      const omega = omegas[i];
      const phi = k * (d.x * x + d.y * z) - (omega + speeds[i]) * t;

      const Q = choppiness / (k * wavelengths[i] * 0.01 + 1e-3);
      const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);

      dx += (Q * A * d.x * cosPhi);
      dy += (A * sinPhi);
      dz += (Q * A * d.y * cosPhi);
    }
    return { x: dx, y: dy, z: dz };
  }

  const t0 = performance.now() / 1000;
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000 - t0;

    // deformación de vértices
    for (let i = 0; i < positions.length; i += 3) {
      const x0 = basePositions[i];
      const z0 = basePositions[i + 2];
      const w = waveXZ(x0, z0, t);
      positions[i]     = x0 + w.x;
      positions[i + 1] = levelY + w.y;
      positions[i + 2] = z0 + w.z;
    }
    ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, false, false);

    // boyancia simple
    const kSpring = 4.0, kDamp = 2.5;
    floaters.forEach(f => {
      const p = f.node.getAbsolutePosition();
      const w = waveXZ(p.x, p.z, t).y;
      const waterY = levelY + w;
      const desiredY = waterY + f.radius;
      const err = desiredY - p.y;
      f.velY = f.velY + (kSpring * err - kDamp * f.velY) * scene.getEngine().getDeltaTime() / 1000;
      f.node.position.y = p.y + f.velY;
    });
  });

  return { mesh: ground, addFloater };
}

const tmpQuat = new BABYLON.Quaternion();

/* =================== Escena principal =================== */
const createScene = async () => {
  const scene = new BABYLON.Scene(engine);

  // ClearColor base
  scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.06, 1);

  // IBL 
  scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(
    "https://assets.babylonjs.com/environments/environmentSpecular.env",
    scene
  );
  scene.imageProcessingConfiguration.exposure = 1.0;  // << pedido
  scene.imageProcessingConfiguration.contrast = 1.05;
  scene.environmentIntensity = 1.0;

  /* ======= Cámara (órbita, zoom, paneo fluido) ======= */
  const camera = new BABYLON.ArcRotateCamera(
    "cam",
    BABYLON.Tools.ToRadians(35),
    BABYLON.Tools.ToRadians(60),
    4000,
    new BABYLON.Vector3(0, 0, 0),
    scene
  );
  camera.attachControl(canvas, true);
  camera.wheelDeltaPercentage = 0.015;
  camera.wheelPrecision = 3;
  camera.pinchPrecision = 3;
  camera.useNaturalPinchZoom = true;
  camera.inputs.attached.pointers.buttons = [0, 1, 2];
  camera.panningSensibility = 16;
  camera.panningInertia = 0.25;
  camera.lowerRadiusLimit = 200;
  camera.upperRadiusLimit = 15000;
  camera.maxZ = 200000;
  camera.keysUp = [87]; camera.keysDown = [83];
  camera.keysLeft = [65]; camera.keysRight = [68];

  // Luz ambiental
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.15;

  /* ======= Skybox propio (día/noche) – GIGANTE e infinito ======= */
  const skybox = BABYLON.MeshBuilder.CreateBox("skybox", { size: 100000 }, scene);
  const skyMat = new BABYLON.BackgroundMaterial("skyMat", scene);
  skyMat.useRGBColor = true;
  skyMat.primaryColor   = new BABYLON.Color3(0.04, 0.07, 0.12);
  skyMat.secondaryColor = new BABYLON.Color3(0.00, 0.02, 0.08);
  skyMat.opacityFresnel = false;
  skyMat.reflectionAmount = 0;
  skyMat.enableReflection = false;
  skyMat.disableLighting = true;
  skybox.material = skyMat;
  skybox.infiniteDistance = true;
  skybox.isPickable = false;
  skybox.applyFog = false;

  const DAY_TOP    = new BABYLON.Color3(0.58, 0.75, 0.96);
  const DAY_BOTTOM = new BABYLON.Color3(0.85, 0.93, 1.00);
  const NIGHT_TOP    = new BABYLON.Color3(0.04, 0.07, 0.12);
  const NIGHT_BOTTOM = new BABYLON.Color3(0.00, 0.02, 0.08);

  /* ======= Sol y Luna + luces/shadows ======= */
  const sunImport = await importSafe("./assets/", "sun.obj", "sol", scene);
  const sunMat = new BABYLON.StandardMaterial("sunMat", scene);
  sunMat.diffuseTexture = new BABYLON.Texture("./assets/sun texture 512x512.png", scene);
  sunMat.emissiveTexture = sunMat.diffuseTexture;
  sunMat.emissiveColor = new BABYLON.Color3(1.0, 0.95, 0.8);
  sunImport.meshes.forEach(m => (m.material = sunMat));
  const { pivot: sunPivot } = normalizeUnderPivot(sunImport, scene, {
    targetSize: 1200, receiveShadows: false
  });

  const moonImport = await importSafe("./assets/", "half moon.obj", "luna", scene);
  const moonMat = new BABYLON.StandardMaterial("moonMat", scene);
  moonMat.diffuseTexture = new BABYLON.Texture("./assets/half moon texture 512x512.png", scene);
  moonMat.emissiveTexture = moonMat.diffuseTexture;
  moonMat.emissiveColor = new BABYLON.Color3(0.6, 0.7, 1.0);
  moonImport.meshes.forEach(m => (m.material = moonMat));
  const { pivot: moonPivot } = normalizeUnderPivot(moonImport, scene, {
    targetSize: 500, receiveShadows: false
  });

  const sunLight  = new BABYLON.DirectionalLight("sunLight",  new BABYLON.Vector3(-1, -1, -1), scene);
  const moonLight = new BABYLON.DirectionalLight("moonLight", new BABYLON.Vector3( 1, -1,  1), scene);
  sunLight.intensity = 1.6;
  moonLight.intensity = 0.35;

  const sunShadows  = new BABYLON.ShadowGenerator(4096, sunLight);
  const moonShadows = new BABYLON.ShadowGenerator(2048, moonLight);
  sunShadows.useExponentialShadowMap = true;
  moonShadows.useExponentialShadowMap = true;

  const glow = new BABYLON.GlowLayer("glow", scene, { blurKernelSize: 32 });
  glow.intensity = 0.5;

  /* ======= ISLAS FLOTANTES ======= */
  const baseTargetSize = 560;
  const ISLAND_FILES = [
    { file: "mushroom_village_house.glb", name: "mushroom", scale: 1.50, band: "outer" },
    { file: "alpha_wolfs_lair.glb",       name: "wolf",     scale: 6.00, band: "outer" },
    { file: "mining_town.glb",            name: "mining",   scale: 10.00, band: "inner", jitter: 0.10 },
    { file: "low_poly_flying_island.glb", name: "lowpoly",  scale: 7.00, band: "inner", jitter: 0.10 }
  ];

  const groundY = -200;
  const sphereR = 2500;
  const extraLift = 2100;
  const sphereCenterY = groundY + sphereR + extraLift;
  const sphereCenter  = new BABYLON.Vector3(0, sphereCenterY, 0);

  // Nubes de fondo (muy al fondo, sin depth write)
  async function addCloudLayer({ scale, opacity = 1.0 }) {
    const imp = await importSafe("./assets/", "stylized_clouds_pack_vol_07.glb", "clouds", scene);
    const node = new BABYLON.TransformNode(`clouds_${scale}_${Math.random().toFixed(3)}`, scene);
    node.renderingGroupId = 0;
    imp.meshes.forEach(m => {
      m.setParent(node);
      m.isPickable = false;
      if (m.material) {
        if ("alpha" in m.material) m.material.alpha = opacity;
        m.material.disableDepthWrite = true;
        m.material.backFaceCulling = false;
      }
    });
    node.scaling = new BABYLON.Vector3(scale, scale, scale * 0.2);
    return node;
  }
// ==== CAPAS DE NUBES (más separación y extensión vertical, incluyendo zonas bajas) ====
const cloudLayers = [];
cloudLayers.push(await addCloudLayer({ scale: 4200, opacity: 0.88 })); // muy lejos
cloudLayers.push(await addCloudLayer({ scale: 3600, opacity: 0.92 }));
cloudLayers.push(await addCloudLayer({ scale: 3200, opacity: 0.95 }));
cloudLayers.push(await addCloudLayer({ scale: 2800, opacity: 0.97 })); // medio
cloudLayers.push(await addCloudLayer({ scale: 2400, opacity: 1.00 })); // cercano
// nuevas capas bajas
cloudLayers.push(await addCloudLayer({ scale: 2600, opacity: 0.94 })); // baja 1
cloudLayers.push(await addCloudLayer({ scale: 2200, opacity: 0.96 })); // baja 2

const randIn = (a, b) => a + Math.random() * (b - a);

// yShift desplaza la banda completa (en múltiplos de sphereR). Valores negativos = más abajo.
const cloudBands = [
  { base: cloudLayers[0], zMul: -6.0, yFactor: 0.95, yShift:  0.00, tiles: [-3.5, -1.5, 0.0, 1.5, 3.5], scale: 4200 },
  { base: cloudLayers[1], zMul: -5.0, yFactor: 0.80, yShift: -0.05, tiles: [-3.0, -1.0, 1.0, 3.0],       scale: 3600 },
  { base: cloudLayers[2], zMul: -4.2, yFactor: 0.68, yShift: -0.08, tiles: [-2.5, 0.0, 2.5],             scale: 3200 },
  { base: cloudLayers[3], zMul: -3.6, yFactor: 0.58, yShift: -0.10, tiles: [-2.0, 2.0],                  scale: 2800 },
  { base: cloudLayers[4], zMul: -3.0, yFactor: 0.48, yShift: -0.10, tiles: [-1.5, 0.0, 1.5],             scale: 2400 },
  { base: cloudLayers[5], zMul: -2.6, yFactor: 0.36, yShift: -0.18, tiles: [-2.2, -0.7, 0.7, 2.2],       scale: 2600 },
  { base: cloudLayers[6], zMul: -2.2, yFactor: 0.28, yShift: -0.22, tiles: [-1.8, 0.0, 1.8],             scale: 2200 }
];

function placeCloudNode(node, { xMul, yFactor, yShift = 0, zMul, scale }) {
  const x = sphereR * (xMul + randIn(-0.28, 0.28));             // más variedad lateral
  const y = sphereR * (yFactor + yShift + randIn(-0.14, 0.14)); // ¡más rango vertical!
  const z = sphereR * zMul;                                      // profundidad (muy al fondo)
  node.position = sphereCenter.add(new BABYLON.Vector3(x, y, z));
  node.scaling  = new BABYLON.Vector3(scale, scale, scale * 0.22);
  node.rotation = new BABYLON.Vector3(0, randIn(-0.4, 0.4), 0);
  node.getChildMeshes().forEach(m => (m.receiveShadows = false));
  node.freezeWorldMatrix();
}

for (const band of cloudBands) {
  const baseUsedCenter = band.tiles.includes(0.0);
  if (baseUsedCenter) {
    placeCloudNode(band.base, { xMul: 0.0, yFactor: band.yFactor, yShift: band.yShift, zMul: band.zMul, scale: band.scale });
  } else {
    placeCloudNode(band.base, { xMul: band.tiles[0], yFactor: band.yFactor, yShift: band.yShift, zMul: band.zMul, scale: band.scale });
  }

  for (const xMul of band.tiles) {
    if (baseUsedCenter && xMul === 0.0) continue;
    const clone = await addCloudLayer({ scale: band.scale, opacity: 0.90 + randIn(-0.07, 0.05) });
    placeCloudNode(clone, {
      xMul,
      yFactor: band.yFactor + randIn(-0.10, 0.10),
      yShift: band.yShift + randIn(-0.04, 0.04),
      zMul: band.zMul + randIn(-0.12, 0.12),
      scale: band.scale * (1.0 + randIn(-0.08, 0.08))
    });
  }
}

  const islands = [];
  const baseGap = 60;
  for (let i = 0; i < ISLAND_FILES.length; i++) {
    const cfg = ISLAND_FILES[i];
    const imp = await importSafe("./assets/", cfg.file, cfg.name, scene);
    makePBRVisible(imp);

    const scaleMul  = cfg.scale ?? 1.0;
    const jitter    = Math.max(0, cfg.jitter ?? 0.0);
    const jitterMul = (jitter === 0) ? 1.0 : (1.0 + Math.random() * jitter);

    const norm = normalizeUnderPivot(imp, scene, {
      targetSize: baseTargetSize * scaleMul * jitterMul,
      groundAlign: false,
      receiveShadows: true
    });
    const pivot = norm.pivot;

    const { size } = getBounds(pivot);
    const radius = Math.max(size.x, size.y, size.z) * 0.52;

    const dir = randomUnitVector();
    const [rMinF, rMaxF] = (cfg.band === "inner") ? [0.22, 0.42] : [0.62, 0.95];
    const radiusPos = sphereR * (rMinF + Math.random() * (rMaxF - rMinF));
    pivot.position = sphereCenter.add(dir.scale(radiusPos));

    pivot.getChildMeshes().forEach(m => {
      m.renderingGroupId = 1; // por delante de nubes
      sunShadows.addShadowCaster(m, true);
      moonShadows.addShadowCaster(m, true);
    });

    islands.push({ pivot, radius, phase: Math.random() * Math.PI * 2, band: cfg.band });
  }

  // Cámara al centro
  camera.target = sphereCenter.clone();
  camera.radius = sphereR * 2.8;

  /* ======= Océano debajo ======= */
  const ocean = createLowPolyOcean(scene, {
    size: 16000,
    subdivisions: 160,
    levelY: groundY - 50,
    amplitude: 20,
    choppiness: 0.9
  });

  /* ======= Animaciones y cielo ======= */
  let t = 0;
  const orbitCenter = sphereCenter.clone();
  const orbitR = sphereR * 2.0;
  const orbitH = sphereR * 0.7;

  function lerp3(a, b, k) {
    return new BABYLON.Color3(
      a.r + (b.r - a.r) * k,
      a.g + (b.g - a.g) * k,
      a.b + (b.b - a.b) * k
    );
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    t += dt * 0.18;

    // órbitas
    const sunPos = new BABYLON.Vector3(
      orbitCenter.x + orbitR * Math.cos(t),
      orbitCenter.y + orbitH * Math.sin(t * 0.8),
      orbitCenter.z + orbitR * Math.sin(t)
    );
    sunPivot.position.copyFrom(sunPos);

    const moonPos = new BABYLON.Vector3(
      orbitCenter.x + orbitR * Math.cos(t + Math.PI),
      orbitCenter.y + orbitH * Math.sin(t * 0.8 + Math.PI),
      orbitCenter.z + orbitR * Math.sin(t + Math.PI)
    );
    moonPivot.position.copyFrom(moonPos);

    sunLight.direction  = orbitCenter.subtract(sunPivot.position).normalize();
    moonLight.direction = orbitCenter.subtract(moonPivot.position).normalize();

    const dayFactor   = Math.max(0, -sunLight.direction.y);
    const nightFactor = Math.max(0, -moonLight.direction.y);
    sunLight.intensity  = 1.05 + 0.9 * dayFactor;
    moonLight.intensity = 0.22 + 0.25 * nightFactor;

    // hover suave
    islands.forEach((it, idx) => {
      const s = 0.5 + (idx % 3) * 0.2;
      it.pivot.position.y += Math.sin(t * s + it.phase) * 0.10;
      it.pivot.rotation.y += 0.05 * dt;
      it.pivot.rotation.x = Math.sin(t * 0.5 + idx) * 0.02;
      it.pivot.rotation.z = Math.cos(t * 0.4 + idx) * 0.015;
    });

    // separación básica para evitar colisiones
    const iterations = 2;
    const baseGap = 60;
    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < islands.length; i++) {
        for (let j = i + 1; j < islands.length; j++) {
          const A = islands[i], B = islands[j];
          const dir = A.pivot.position.subtract(B.pivot.position);
          let dist = dir.length();
          if (dist < 1e-3) {
            const rnd = randomUnitVector().scale(0.01);
            A.pivot.position.addInPlace(rnd);
            B.pivot.position.subtractInPlace(rnd);
            dist = 0.01;
          }
          const minDist = A.radius + B.radius + baseGap;
          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            const push = dir.normalize().scale(overlap);
            A.pivot.position.addInPlace(push);
            B.pivot.position.subtractInPlace(push);
          }
        }
      }
      const astroMin = 180;
      const astroList = [
        { pos: sunPivot.position, r: astroMin },
        { pos: moonPivot.position, r: astroMin }
      ];
      islands.forEach(A => {
        astroList.forEach(astro => {
          const dir = A.pivot.position.subtract(astro.pos);
          let dist = dir.length();
          if (dist < 1e-3) { A.pivot.position.addInPlace(randomUnitVector().scale(0.02)); dist = 0.02; }
          const minDist = A.radius + astro.r;
          if (dist < minDist) {
            const push = dir.normalize().scale((minDist - dist));
            A.pivot.position.addInPlace(push);
          }
        });
      });
      islands.forEach(A => {
        const vec = A.pivot.position.subtract(sphereCenter);
        const d = vec.length();
        const maxR = sphereR * 0.98;
        if (d > maxR) {
          A.pivot.position = sphereCenter.add(vec.normalize().scale(maxR));
        }
      });
    }

    // cielo día/noche según astro más alto
    const sunH  = sunPos.y  - orbitCenter.y;
    const moonH = moonPos.y - orbitCenter.y;
    const kRaw = (sunH - moonH) / (Math.abs(sunH) + Math.abs(moonH) + 1e-5);
    const k = Math.max(0, Math.min(1, 0.5 + 0.5 * kRaw));
    const top    = lerp3(NIGHT_TOP,    DAY_TOP,    k);
    const bottom = lerp3(NIGHT_BOTTOM, DAY_BOTTOM, k);
    skyMat.primaryColor   = lerp3(skyMat.primaryColor,   top,    Math.min(1, dt * 2.0));
    skyMat.secondaryColor = lerp3(skyMat.secondaryColor, bottom, Math.min(1, dt * 2.0));
  });

  engine.hideLoadingUI();
  return scene;
};

createScene().then(scene => {
  engine.runRenderLoop(() => scene.render());
}).catch(e => {
  engine.hideLoadingUI();
  console.error("No se pudo crear la escena:", e);
});

window.addEventListener("resize", () => engine.resize());
