// ============================================================
// Escaneo Facial 3D Interactivo (p5.js + ml5.js FaceMesh)
// Requisitos del PDF + CAMBIO solicitado por el usuario:
//   - Mostrar VIDEO y MALLA 3D simultáneamente.
//   - Sin opciones de UI (sin botones/sliders/checkbox).
//   - La cámara/video se inicia automáticamente al cargar.
// Extras implementados:
//   - Iluminación ambiental + direccional rotante.
//   - Deformación automática por expresión (boca abierta).
//   - Detección simple de parpadeo (destello de color).
//   - Manejo básico de errores de cámara y estado en pantalla.
//   - Triangulación calculada una sola vez con Delaunator.
// ============================================================

let faceMesh;              // Modelo de ml5.js
let video;                 // Flujo de cámara
let faces = [];            // Predicciones de rostros
let triIndices = null;     // Índices de triángulos (calculados 1 sola vez)
let lightAngle = 0;        // Rotación de la luz direccional
let statusText = "Inicializando...";
let cameraReady = false;
let cameraError = false;

const options = {
  maxFaces: 1,
  refineLandmarks: true,
  flipHorizontal: true // espejo para alinear con el video
};

function setup() {
  // Canvas WEBGL y responsivo
  const w = Math.min(windowWidth * 0.95, 900);
  const h = Math.round(w * 0.75);
  const canvas = createCanvas(w, h, WEBGL);
  canvas.parent("canvas-container");
  frameRate(30);
  pixelDensity(1);

  // Crear el video (autoplay y oculto en el DOM, lo dibujamos al canvas)
  video = createCapture({ video: { facingMode: "user" }, audio: false }, () => {
    cameraReady = true;
    statusText = "Cámara lista, cargando modelo FaceMesh...";
  });
  // Tamaño base del stream (usado como referencia para el mapeo de puntos)
  video.size(640, 480);
  video.hide();
  // Ajustes para mejor compatibilidad de autoplay en móviles
  video.elt.setAttribute("playsinline", "");
  video.elt.setAttribute("autoplay", "");
  video.elt.muted = true;

  // Cargar FaceMesh y arrancar detección
  faceMesh = ml5.faceMesh(options, () => {
    statusText = "Modelo FaceMesh cargado. Detectando rostro...";
    faceMesh.detectStart(video, (results) => {
      faces = results || [];
      // Al primer rostro, calculamos triangulación con Delaunator y la reutilizamos.
      if (!triIndices && faces.length > 0 && faces[0].scaledMesh && window.Delaunator) {
        const pts2D = faces[0].scaledMesh.map((p) => [p[0], p[1]]); // x,y
        const d = Delaunator.from(pts2D);
        triIndices = d.triangles; // Uint32Array con índices
      }
    });
  });

  // Si la cámara no responde en 6s, mostrarmos error
  setTimeout(() => {
    if (!cameraReady) {
      cameraError = true;
      statusText = "No se pudo acceder a la cámara. Revisa permisos o HTTPS/localhost.";
    }
  }, 6000);
}

function draw() {
  background(26);

  // --- VIDEO DE FONDO (espejado) ---
  // Lo dibujamos como imagen plana detrás de la malla (z negativo) para que se vean ambos.
  push();
  // En WEBGL, (0,0) es el centro. Espejamos en X para coincidir con flipHorizontal.
  scale(-1, 1, 1);
  translate(0, 0, -200);
  // Dibujar desde la esquina superior izquierda del canvas
  image(video, -width / 2, -height / 2, width, height);
  pop();

  // --- LUCES 3D ---
  // Luz ambiental suave + direccional rotante alrededor del rostro
  ambientLight(80);
  const lx = Math.cos(lightAngle) * 300;
  const lz = Math.sin(lightAngle) * 300;
  directionalLight(255, 255, 255, lx, -120, lz);
  lightAngle += 0.02;

  // --- MALLA FACIAL ---
  if (faces.length > 0 && faces[0].scaledMesh) {
    statusText = "Rostro detectado";
    drawFaceMesh(faces[0]);
  } else {
    statusText = cameraError ? "Error de cámara" : "Buscando rostro...";
  }

  // --- HUD de estado ---
  drawHUD(statusText);
  // También actualizamos el DOM por accesibilidad
  const sEl = document.getElementById("status");
  if (sEl) sEl.textContent = statusText;
}

function drawFaceMesh(face) {
  const pts = face.scaledMesh; // Array de 468 puntos: [x,y,z]
  if (!pts || pts.length !== 468) return;

  const mouthIsOpen = isMouthOpen(pts);
  const blink = isBlinking(pts);

  // Color base: si hay boca abierta, cálido; si parpadeo, dorado
  let fillColor = mouthIsOpen ? [255, 120, 80] : [120, 200, 255];
  if (blink) fillColor = [255, 220, 0];

  noStroke();
  ambientMaterial(fillColor[0], fillColor[1], fillColor[2]);

  // Triangulación disponible (reutilizada cada frame)
  if (!triIndices && window.Delaunator) {
    const d = Delaunator.from(pts.map((p) => [p[0], p[1]]));
    triIndices = d.triangles;
  }

  if (triIndices) {
    beginShape(TRIANGLES);
    for (let i = 0; i < triIndices.length; i += 3) {
      const a = triIndices[i];
      const b = triIndices[i + 1];
      const c = triIndices[i + 2];

      let va = mapToCanvas3D(pts[a]);
      let vb = mapToCanvas3D(pts[b]);
      let vc = mapToCanvas3D(pts[c]);

      // Deformación sutil cerca de la boca cuando está abierta
      if (mouthIsOpen) {
        const m = mouthCenter(pts);
        const influence = 80;      // radio de influencia en píxeles (espacio de video)
        const pushZ = 12;          // cuánto sobresale hacia la cámara

        va = deformNearMouth(va, pts[a], m, influence, pushZ);
        vb = deformNearMouth(vb, pts[b], m, influence, pushZ);
        vc = deformNearMouth(vc, pts[c], m, influence, pushZ);
      }

      vertex(va.x, va.y, va.z);
      vertex(vb.x, vb.y, vb.z);
      vertex(vc.x, vc.y, vc.z);
    }
    endShape();
  } else {
    // Fallback visual si no hay triangulación: puntos
    stroke(0, 255, 255);
    strokeWeight(2);
    for (let i = 0; i < pts.length; i++) {
      const v = mapToCanvas3D(pts[i]);
      point(v.x, v.y, v.z);
    }
  }
}

// --- UTILIDADES DE MALLA/GEOMETRÍA ---
function mapToCanvas3D(p) {
  // p = [x,y,z] en coordenadas de video (px). Convertimos a coordenadas WEBGL del canvas.
  const videoW = video.width || 640;
  const videoH = video.height || 480;

  // Convertimos x,y: (0..videoW, 0..videoH) -> (-videoW/2..videoW/2, videoH/2..-videoH/2)
  const x = p[0] - videoW / 2;
  const y = (videoH / 2) - p[1];

  // z es negativo (más lejos) en FaceMesh. Lo escalamos para que se aprecie la profundidad.
  const z = -p[2] * 1.5;

  // Ajustamos por el escalado del canvas respecto al video, para mantener proporciones.
  const sx = width / videoW;
  const sy = height / videoH;
  const s = (sx + sy) * 0.5;

  return { x: x * sx, y: y * sy, z: z * s };
}

function mouthCenter(pts) {
  const up = pts[13];  // labio superior
  const low = pts[14]; // labio inferior
  return { x: (up[0] + low[0]) * 0.5, y: (up[1] + low[1]) * 0.5 };
}

function deformNearMouth(vCanvas, pVideo, mouth, influence = 80, pushZ = 12) {
  const d = dist(pVideo[0], pVideo[1], mouth.x, mouth.y);
  if (d < influence) {
    const k = 1 - d / influence;   // 0..1
    return { x: vCanvas.x, y: vCanvas.y, z: vCanvas.z - k * pushZ };
  }
  return vCanvas;
}

function isMouthOpen(pts) {
  // Distancia vertical entre 13 (labio sup.) y 14 (labio inf.)
  const up = pts[13];
  const low = pts[14];
  const mouthDist = Math.hypot(up[0] - low[0], up[1] - low[1]);

  // Normalizamos por la altura de la cara (10 frente ~ 152 mentón)
  const top = pts[10];
  const chin = pts[152];
  const faceH = Math.hypot(top[0] - chin[0], top[1] - chin[1]);
  const ratio = mouthDist / faceH;

  // Umbral empírico
  return ratio > 0.06;
}

function isBlinking(pts) {
  // Parpadeo simple con distancias verticales de párpados
  // Ojo izq.: 159 (párpado sup.), 145 (párpado inf.)
  // Ojo der.: 386 (sup.), 374 (inf.)
  const l = Math.hypot(pts[159][0] - pts[145][0], pts[159][1] - pts[145][1]);
  const r = Math.hypot(pts[386][0] - pts[374][0], pts[386][1] - pts[374][1]);

  const top = pts[10], chin = pts[152];
  const faceH = Math.hypot(top[0] - chin[0], top[1] - chin[1]);

  const rl = l / faceH;
  const rr = r / faceH;
  return rl < 0.012 && rr < 0.012;
}

function drawHUD(textLine) {
  // HUD 2D superpuesto (sin afectar la escena 3D)
  push();
  resetMatrix();
  noLights(); // el HUD no necesita luces
  fill(255);
  noStroke();
  textSize(14);
  textAlign(LEFT, TOP);
  text(textLine, 12, 12);
  pop();
}

function windowResized() {
  const w = Math.min(windowWidth * 0.95, 900);
  const h = Math.round(w * 0.75);
  resizeCanvas(w, h);
}
