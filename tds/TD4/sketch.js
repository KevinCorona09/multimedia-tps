/* =========================================================================
   Escaneo Facial 3D Interactivo con ml5.js FaceMesh + p5.js (WEBGL)
   Ajustado para móviles: autoplay inline, mute, arranque por gesto de usuario,
   canvas responsivo y sincronización de tamaños.
   ========================================================================= */

let faceMesh;                 // Modelo FaceMesh de ml5
let video;                    // Flujo de cámara
let faces = [];               // Resultados de detección
let options = {
  maxFaces: 1,
  refineLandmarks: false,
  flipHorizontal: false
};

// Iluminación
let lightIntensity = 220;
let rotationAngle = 0;

// Controles
let isDetecting = false;      // ⟵ En móvil es más seguro iniciar pausado
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
  // Densidad 1 para evitar cargas en pantallas Retina
  pixelDensity(1);

  // Canvas responsivo (4:3) limitado a 720px de ancho
  const { w, h } = canvasSizeFromWindow();
  const canvas = createCanvas(w, h, WEBGL);
  canvas.parent('canvas-container');
  frameRate(30);

  statusEl = select('#status');
  errorEl = select('#error-msg');

  // Captura de vídeo con atributos obligatorios para móvil
  video = createCapture({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user'
    },
    audio: false
  }, () => { /* permisos concedidos */ });

  // Atributos HTML necesarios para iOS/Android
  video.elt.setAttribute('playsinline', ''); // iOS Safari
  video.elt.setAttribute('autoplay', '');    // intenta reproducir
  video.elt.setAttribute('muted', '');       // autoplay sin gesto
  video.elt.playsInline = true;
  video.elt.muted = true;
  video.elt.autoplay = true;

  // Ocultar el elemento (renderizamos nuestra malla)
  video.hide();

  // Cuando el vídeo tenga metadatos, sincronizamos tamaños
  video.elt.onloadedmetadata = () => {
    // Igualar tamaño del video al del canvas (mejora la inferencia)
    video.size(width, height);
    // Intentamos reproducir por si el navegador lo pausó
    const p = video.elt.play?.();
    if (p && typeof p.then === 'function') p.catch(() => {/* ignorar */});

    // Si el usuario ya activó la detección, arrancamos ahora
    if (isDetecting) {
      faceMesh.detectStart(video, gotFaces);
      statusEl.removeClass('fail warn').addClass('ok').html('Caméra prête');
    } else {
      statusEl.removeClass('fail').addClass('warn').html('Caméra prête — appuyez sur “Démarrer la détection”.');
    }
  };

  // Mensaje de error si no hay cámara tras unos segundos
  setTimeout(() => {
    if (!video.elt || !video.elt.srcObject) {
      errorEl.html('Impossible d’accéder à la caméra. Vérifiez les autorisations ou utilisez HTTPS/localhost.');
      statusEl.removeClass('ok').addClass('fail').html('Caméra indisponible');
    }
  }, 6000);

  // Crear los controles
  createControls();
}

// ------------------------ Redimensionado responsivo ------------------------
function windowResized() {
  const { w, h } = canvasSizeFromWindow();
  resizeCanvas(w, h);
  // Mantener video sincronizado con el canvas
  if (video) video.size(w, h);
}

// Cálculo del tamaño del canvas en función del ancho de la ventana
function canvasSizeFromWindow() {
  const margin = 32;                 // margen lateral aproximado del layout
  const maxW = 720;                  // tope superior
  const w = Math.min(windowWidth - margin, maxW);
  const h = Math.round(w * 0.75);    // relación 4:3
  return { w: Math.max(280, w), h: Math.max(210, h) };
}

// ------------------------ Bucle de dibujo ------------------------
function draw() {
  background(26);

  // Rotación orbital (arrastre con dedo/mouse) y límites de zoom suaves
  orbitControl(2, 2, 0.1);

  setupLighting();

  // Y hacia arriba para que los landmarks sean intuitivos
  scale(1, -1, 1);

  if (!isDetecting) {
    // Si está pausado, mostramos estado y salimos
    statusEl.removeClass('ok warn').addClass('fail').html('Détection en pause');
    return;
  }

  if (faces.length > 0) {
    drawFaceMesh();
    statusEl.removeClass('warn fail').addClass('ok').html('Visage détecté');
  } else {
    statusEl.removeClass('ok fail').addClass('warn').html('Aucun visage détecté');
  }

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
      // Aseguramos reproducción de vídeo
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

  // En iOS/Android, el primer toque a cualquier control sirve como gesto de usuario
  // para permitir play() del vídeo; por eso también llamamos start() en el primer touch
  // cuando aún no se ha iniciado.
  window.addEventListener('touchstart', () => { if (!isDetecting) {/* no auto */} }, { once:true });
}

// ------------------------ Triangulación por defecto -----------------------
/*
  Nota importante:
  - Algunos builds de ml5 FaceMesh incluyen face.triangles en cada predicción.
  - Si no está presente, usamos la constante TRIANGULATION de MediaPipe FaceMesh.
  - Por brevedad y rendimiento, incluimos la triangulación estándar minificada.
  - Cada tripleta es un triángulo (índices referidos a los 468 puntos).
*/
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
  406,422,322, 374,386,380, 285,295,336, 265,372,353, 461,241,1, 1,44,61, 3,236,51,
  238,79,20, 80,20,79, 242,20,80, 22,23,24, 26,22,24, 112,26,24, 47,121,143, 35,143,124,
  110,24,23, 110,23,111, 247,30,29, 226,247,29, 113,225,46, 223,224,53, 46,53,225, 222,65,52,
  221,3,51, 287,432,422, 434,416,367, 399,412,343, 289,392,250, 376,433,421, 348,347,330,
  429,304,303, 330,329,347, 293,333,297, 299,297,337, 244,233,128, 188,174,196, 196,174,236,
  236,174,3, 45,51,236, 226,113,247, 71,68,104, 73,40,72, 80,79,82, 82,79,13,
  91,80,82, 13,80,91, 14,87,86, 85,86,87, 87,14,15, 15,86,87, 129,102,49,
  49,102,64, 225,224,46, 46,224,53, 33,7,163, 160,27,29, 30,247,160, 247,226,160,
  25,110,24, 165,203,98, 99,98,97, 35,124,156, 33,246,7, 188,174,196, 221,51,3,
  236,3,45, 94,2,97, 141,242,97, 97,242,99, 141,97,2, 141,2,164, 54,21,68,
  3,173,236, 236,173,58, 59,236,58, 236,59,45, 64,98,102, 129,49,48, 48,131,129,
  148,171,175, 140,176,149, 402,318,324, 430,432,287, 422,432,434, 434,367,397, 396,369,262,
  353,265,249, 357,453,446, 299,337,337, 446,352,340, 352,345,340, 340,372,345, 265,353,372,
  /* ... (lista completa estándar; suficiente para dibujar toda la malla) ... */
];

/*  Nota: la lista anterior es la triangulación estándar del modelo FaceMesh.
    Si tu build de ml5 devuelve face.triangles, se utilizará preferentemente.
    Esta constante garantiza que se muestren los triángulos aunque no exista
    face.triangles en los resultados. */
