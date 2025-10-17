let facemesh;
let video;
let predictions = [];

let statusEl, errorEl;

function setup() {
  // Contenedor y dimensiones
  const container = document.getElementById('canvas-container');
  const w = Math.min(720, container.clientWidth || windowWidth);
  const h = Math.round(w * 0.75); // 4:3

  const canvas = createCanvas(w, h);
  canvas.parent('canvas-container');

  pixelDensity(1);

  statusEl = select('#status');
  errorEl  = select('#error-msg');

  // Cámara (front) — playsinline evita pausas en iOS
  video = createCapture(
    { video: { facingMode: 'user', width: w, height: h }, audio: false },
    () => {}
  );
  video.size(w, h);
  video.elt.setAttribute('playsinline', ''); // iOS/WebKit
  video.hide();

  video.elt.onloadeddata = () => {
    statusEl.removeClass('fail warn').addClass('ok').html('✓ Cámara lista');
  };

  // Modelo FaceMesh de ml5 — detección automática (sin botones)
  try {
    facemesh = ml5.facemesh(video, { maxFaces: 1 }, modelReady);
    facemesh.on('predict', (results) => { predictions = results || []; });
  } catch (e) {
    console.error(e);
    statusEl.removeClass('ok warn').addClass('fail').html('✖ Error iniciando FaceMesh');
    errorEl.html(String(e));
  }
}

function modelReady() {
  statusEl.removeClass('fail warn').addClass('ok').html('✓ Modelo listo — detectando...');
}

function draw() {
  background(0);

  // Dibuja el video espejado (selfie)
  push();
  imageMirrored(video, 0, 0, width, height);
  pop();

  // Dibuja malla si hay predicciones
  if (predictions.length > 0) {
    statusEl.removeClass('warn fail').addClass('ok').html('✓ Rostro detectado');

    const pred = predictions[0];
    drawWireframe(pred);
    drawLabels(pred);
  } else {
    statusEl.removeClass('ok fail').addClass('warn').html('⚠ Buscando rostro...');
  }
}

/* ---------- Utilidades de dibujo ---------- */

// Dibuja la imagen espejada sin afectar el sistema de coordenadas
function imageMirrored(img, x, y, w, h) {
  push();
  translate(x + w, y);
  scale(-1, 1);
  image(img, 0, 0, w, h);
  pop();
}

// Convierte un x a su espejo para alinear con el video espejado
function mx(x) { return width - x; }

// Dibuja el wireframe usando las anotaciones del modelo
function drawWireframe(pred) {
  const ann = pred.annotations || {};
  stroke(0, 255, 255);
  strokeWeight(1);
  noFill();

  const paths = [
    'silhouette',
    'leftEyebrowUpper', 'leftEyebrowLower',
    'rightEyebrowUpper','rightEyebrowLower',
    'leftEyeUpper0', 'leftEyeLower0',
    'rightEyeUpper0','rightEyeLower0',
    'lipsUpperOuter','lipsLowerOuter',
    'lipsUpperInner','lipsLowerInner',
    'noseBridge','noseTip'
  ];

  for (const key of paths) {
    if (!ann[key]) continue;
    const pts = ann[key];
    beginShape();
    for (const p of pts) {
      const x = mx(p[0]);
      const y = p[1];
      vertex(x, y);
    }
    // Cerrar algunas rutas
    const closed =
      key === 'silhouette' ||
      key === 'lipsUpperOuter' || key === 'lipsLowerOuter' ||
      key === 'lipsUpperInner' || key === 'lipsLowerInner';
    endShape(closed ? CLOSE : undefined);
  }

  // Opcional: puntos finos para densidad visual
  stroke(0, 255, 180);
  strokeWeight(2);
  const mesh = pred.scaledMesh || [];
  for (const p of mesh) {
    point(mx(p[0]), p[1]);
  }
}

// Escribe “ojos”, “boca”, “nariz”
function drawLabels(pred) {
  const a = pred.annotations || {};

  // Ojos: centro entre el centro de cada ojo
  const leftEyeC  = avg2D(a.leftEyeUpper0, a.leftEyeLower0);
  const rightEyeC = avg2D(a.rightEyeUpper0, a.rightEyeLower0);
  const eyesC = mid2D(leftEyeC, rightEyeC);

  // Boca: promedio de upper+lower outer
  const mouthC = avg2D(a.lipsUpperOuter, a.lipsLowerOuter);

  // Nariz: punta o puente
  const noseC = avg2D(a.noseTip || a.noseBridge);

  noStroke();
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(16);

  if (eyesC)  text('ojos',  mx(eyesC[0]),  eyesC[1]  - 18);
  if (mouthC) text('boca',  mx(mouthC[0]), mouthC[1] + 18);
  if (noseC)  text('nariz', mx(noseC[0]),  noseC[1]  - 12);
}

/* ---------- Helpers geométricos ---------- */

// Promedio de múltiples listas de puntos 2D (arrays de [x,y,(z)])
function avg2D(...groups) {
  const pts = [];
  for (const g of groups) {
    if (!g) continue;
    for (const p of g) pts.push(p);
  }
  if (pts.length === 0) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p[0]; sy += p[1]; }
  return [sx / pts.length, sy / pts.length];
}

function mid2D(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/* ---------- Resize ---------- */
function windowResized() {
  const container = document.getElementById('canvas-container');
  const w = Math.min(720, container.clientWidth || windowWidth);
  const h = Math.round(w * 0.75);
  resizeCanvas(w, h);
  if (video) video.size(w, h);
}
