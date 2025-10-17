/* =========================================================================
   Escaneo Facial 3D Interactivo con ml5.js FaceMesh + p5.js (WEBGL)
   Correcciones:
   - Se dibuja el VIDEO como textura de fondo (plano) y en espejo.
   - El tamaño del canvas se calcula con el ancho REAL del contenedor.
   - flipHorizontal activado para alinear landmarks con la cámara frontal.
   ========================================================================= */

let faceMesh;                 // Modelo FaceMesh de ml5
let video;                    // Flujo de cámara
let faces = [];               // Resultados de detección
let options = {
  maxFaces: 1,
  refineLandmarks: false,
  flipHorizontal: true       // ✅ espejo para cámara frontal
};

// Iluminación
let lightIntensity = 220;
let rotationAngle = 0;

// Controles
let isDetecting = false;      // Arranque pausado hasta gesto del usuario
let showKeypoints = false;
let enableDeformation = true;

// Referencias de UI
let statusEl, errorEl;

// ------------------------ Carga del modelo ------------------------
function preload() {
  faceMesh = ml5.faceMesh(options);
}

// ------------------------ Setup ------------------------
function setup() {
  pixelDensity(1);

  const { w, h } = canvasSizeFromContainer();
  const canvas = createCanvas(w, h, WEBGL);
  canvas.parent('canvas-container');
  frameRate(30);

  statusEl = select('#status');
  errorEl = select('#error-msg');

  // Captura de vídeo con atributos para móvil
  video = createCapture({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user'
    },
    audio: false
  });

  // Atributos HTML necesarios para iOS/Android
  video.elt.setAttribute('playsinline', '');
  video.elt.setAttribute('autoplay', '');
  video.elt.setAttribute('muted', '');
  video.elt.playsInline = true;
  video.elt.muted = true;
  video.elt.autoplay = true;

  // Ocultamos el <video> nativo; lo dibujamos como textura en el canvas
  video.hide();

  // Cuando el vídeo tenga metadatos, sincronizamos tamaños
  video.elt.onloadedmetadata = () => {
    video.size(width, height);                 // ✅ igualar a canvas
    const p = video.elt.play?.();
    if (p && typeof p.then === 'function') p.catch(() => {/* ignorar */});

    if (isDetecting) {
      faceMesh.detectStart(video, gotFaces);
      statusEl.removeClass('fail warn').addClass('ok').html('Caméra prête');
    } else {
      statusEl.removeClass('fail').addClass('warn').html('Caméra prête — appuyez sur “Démarrer la détection”.');
    }
  };

  // Mensaje de error si no hay cámara
  setTimeout(() => {
    if (!video.elt || !video.elt.srcObject) {
      errorEl.html('Impossible d’accéder à la caméra. Vérifiez les autorisations ou utilisez HTTPS/localhost.');
      statusEl.removeClass('ok').addClass('fail').html('Caméra indisponible');
    }
  }, 6000);

  createControls();
}

// ------------------------ Redimensionado responsivo ------------------------
function windowResized() {
  const { w, h } = canvasSizeFromContainer();
  resizeCanvas(w, h);
  if (video) video.size(w, h);                // ✅ mantener sincronía
}

// Cálculo del tamaño del canvas en función del ancho del CONTENEDOR
function canvasSizeFromContainer() {
  const el = document.getElementById('canvas-container');
  const maxW = 720;
  const baseW = el?.clientWidth ? Math.min(el.clientWidth, maxW) : Math.min(windowWidth - 32, maxW);
  const w = Math.max(280, baseW);
  const h = Math.max(210, Math.round(w * 0.75));  // relación 4:3
  return { w, h };
}

// ------------------------ Bucle de dibujo ------------------------
function draw() {
  background(26);

  // Controles de cámara 3D
  orbitControl(2, 2, 0.1);
  setupLighting();

  // 1) DIBUJAR EL VÍDEO como fondo (en espejo horizontal)
  if (video && video.width && video.height) {
    push();
    noStroke();
    // Plano al fondo; espejo horizontal con scale(-1,1,1)
    // (Ojo: aquí NO invertimos el eje Y)
    translate(0, 0, -400);
    scale(-1, 1, 1);
    texture(video);
    plane(width, height);
    pop();
  }

  // 2) DIBUJAR LA MALLA (invertimos Y para que los landmarks sean intuitivos)
  push();
  scale(1, -1, 1);

  if (!isDetecting) {
    statusEl.removeClass('ok warn').addClass('fail').html('Détection en pause');
    pop();
    return;
  }

  if (faces.length > 0) {
    drawFaceMesh();
    statusEl.removeClass('warn fail').addClass('ok').html('Visage détecté');
  } else {
    statusEl.removeClass('ok fail').addClass('warn').html('Aucun visage détecté');
  }
  pop();

  rotationAngle += 0.01;
}

// ------------------------ Callback de predicción ---------------------------
function gotFaces(results) { faces = results || []; }

// ------------------------ Luces ------------------------
function setupLighting() {
  ambientLight(lightIntensity * 0.3);
  const lx = cos(rotationAngle), lz = sin(rotationAngle), ly = -0.35;
  directionalLight(lightIntensity, lightIntensity, lightIntensity, lx, ly, lz);
}

// ------------------------ Malla facial 3D ------------------------
function drawFaceMesh() {
  const face = faces[0];
  const raw = face?.keypoints || face?.scaledMesh || face?.landmarks || [];
  if (!raw.length) return;

  const pts = raw.map(p => {
    let x, y, z;
    if (Array.isArray(p)) [x, y, z] = p; else { x = p.x; y = p.y; z = p.z; }
    const cx = x - (video.width / 2);
    const cy = y - (video.height / 2);
    const cz = -(z || 0) * 110;
    return { x: cx, y: cy, z: cz };
  });

  const mouthOpenRatio = detectMouthOpen(pts);
  const isBlinking = detectBlink(pts);
  const deformStrength = enableDeformation ? constrain(map(mouthOpenRatio, 0.05, 0.25, 0, 1), 0, 1) : 0;

  noStroke();
  if (isBlinking) emissiveMaterial(70, 70, 70);
  else if (deformStrength > 0.01) ambientMaterial(160 + 60 * deformStrength, 120, 120);
  else ambientMaterial(185);

  const tris = face.triangles || TRIANGULATION;
  if (!tris?.length) return;

  beginShape(TRIANGLES);
  for (let i = 0; i < tris.length; i += 3) {
    const v0 = applyDeformation(pts[tris[i]], pts, deformStrength);
    const v1 = applyDeformation(pts[tris[i+1]], pts, deformStrength);
    const v2 = applyDeformation(pts[tris[i+2]], pts, deformStrength);
    vertex(v0.x, v0.y, v0.z); vertex(v1.x, v1.y, v1.z); vertex(v2.x, v2.y, v2.z);
  }
  endShape();

  if (showKeypoints) {
    stroke(0, 255, 255); strokeWeight(3); noFill();
    for (const p of pts) point(p.x, p.y, p.z);
  }
}

// ------------------------ Deformación por expresión -----------------------
function applyDeformation(p, pts, s) {
  if (!s) return p;
  const mouthCenter = {
    x: (pts[13].x + pts[14].x) * .5,
    y: (pts[13].y + pts[14].y) * .5,
    z: (pts[13].z + pts[14].z) * .5
  };
  const dx = p.x - mouthCenter.x, dy = p.y - mouthCenter.y, dz = p.z - mouthCenter.z;
  const d2 = dx*dx + dy*dy + dz*dz, radius2 = 70*70;
  if (d2 > radius2) return p;
  const w = (1 - (d2 / radius2)) * s;
  return { x: p.x, y: p.y + 10*w, z: p.z - 14*w };
}

// ------------------------ Detección de gestos -----------------------------
function detectMouthOpen(pts) {
  if (!pts[13] || !pts[14] || !pts[61] || !pts[291]) return 0;
  const mouthOpen = dist3D(pts[13], pts[14]), mouthWidth = dist3D(pts[61], pts[291]);
  return mouthOpen / (mouthWidth || 1);
}
function detectBlink(pts) {
  const need = [159,145,33,133,386,374,362,263]; for (const i of need) if (!pts[i]) return false;
  const lRatio = dist3D(pts[159], pts[145]) / (dist3D(pts[33],  pts[133]) || 1);
  const rRatio = dist3D(pts[386], pts[374]) / (dist3D(pts[362], pts[263]) || 1);
  return (lRatio < 0.045 && rRatio < 0.045);
}
function dist3D(a,b){ const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z; return Math.hypot(dx,dy,dz); }

// ------------------------ Controles de UI (p5 DOM) ------------------------
function createControls() {
  const ui = select('#controls');

  // Botón iniciar/pausar — inicia por gesto del usuario (móvil friendly)
  const btn = createButton('▶️ Démarrer la détection');
  btn.addClass('control'); btn.parent(ui);
  const start = () => {
    if (!isDetecting) {
      const p = video?.elt?.play?.(); if (p && p.then) p.catch(()=>{});
      faceMesh.detectStart(video, gotFaces);
      isDetecting = true;
      btn.html('⏸️ Mettre en pause');
      statusEl.removeClass('warn fail').addClass('ok').html('Détection en cours');
    } else {
      faceMesh.detectStop();
      isDetecting = false;
      btn.html('▶️ Démarrer la détection');
      statusEl.removeClass('ok warn').addClass('fail').html('Détection en pause');
    }
  };
  btn.mousePressed(start);

  // Slider de luz
  const boxLight = createDiv('').addClass('control').parent(ui);
  const lblLight = createElement('label', 'Intensité de la lumière'); lblLight.parent(boxLight);
  const slider = createSlider(50, 255, lightIntensity, 1); slider.parent(boxLight);
  slider.input(() => (lightIntensity = slider.value()));

  // Checkboxes
  const boxDef = createDiv('').addClass('control').parent(ui);
  const chkDef = createCheckbox('Déformation par expression', enableDeformation);
  chkDef.parent(boxDef); chkDef.changed(() => (enableDeformation = chkDef.checked()));

  const boxPts = createDiv('').addClass('control').parent(ui);
  const chkPts = createCheckbox('Afficher les points clés', showKeypoints);
  chkPts.parent(boxPts); chkPts.changed(() => (showKeypoints = chkPts.checked()));

  // Primer toque sirve como gesto de usuario para permitir play() del vídeo
  window.addEventListener('touchstart', () => { /* noop */ }, { once:true });
}

// ------------------------ Triangulación por defecto -----------------------
const TRIANGULATION = [
  127,34,139, 11,0,37, 232,231,120, 72,37,39, 128,121,47, 232,121,128, 104,69,67,
  175,171,148, 157,154,155, 118,50,101, 73,39,40, 9,151,108, 48,115,131, 194,204,211,
  74,40,185, 80,42,183, 40,92,186, 230,229,118, 202,212,214, 83,18,17, 76,61,146,
  160,29,30, 56,157,173, 106,204,194, 135,214,192, 203,165,98, 21,71,68, 51,45,4,
  5,4,275, 440,275,4, 363,343,412, 386,258,387, 258,445,387, 265,353,342, 387,259,386,
  260,386,259, 257,386,260, 249,390,373, 463,341,464, 453,357,465, 289,251,375, 308,324,318,
  291,375,251, 285,417,335, 405,314,313, 17,16,8, 264,356,454, 356,264,19, 236,353,265,
  454,356,461, 359,255,339, 254,448,261, 370,345,372, 423,358,327, 327,358,326, 320,321,405,
  280,267,311, 309,438,291, 305,290,392, 290,305,460, 300,276,383, 292,308,324, 290,460,328,
  376,433,435, 250,290,328, 385,258,259, 257,259,258, 386,257,385, 443,444,282, 285,336,417,
  406,418,419, 426,436,423, 429,420,421, 360,363,440, 437,399,456, 420,437,456, 363,360,279,
  278,279,360, 333,332,297, 175,152,377, 365,397,367, 440,437,438, 297,338,337, 335,273,321,
  348,330,329, 293,298,333, 252,272,271, 322,320,406, 271,311,268, 313,314,17, 287,291,423,
  406,422,322, 374,386,380, 285,295,336, 265,372,353
  /* (lista reducida para fallback; si ml5 provee face.triangles se usa aquello) */
];
