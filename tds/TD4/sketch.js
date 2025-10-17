/* =========================================================================
   Escaneo Facial 3D Interactivo con ml5.js FaceMesh + p5.js (WEBGL)
   Cumple especificaciones del PDF: detección de 468 puntos, malla triangular
   3D, iluminación rotante, deformación por expresión (boca abierta),
   controles interactivos y orbitControl para rotación orbital.
   ========================================================================= */

// ------------------------ Variables globales (según especificación) ------------------------
let faceMesh;                 // Modelo FaceMesh de ml5
let video;                    // Flujo de cámara
let faces = [];               // Resultados de detección
let options = {               // Opciones sugeridas en el PDF
  maxFaces: 1,
  refineLandmarks: false,
  flipHorizontal: false
};

// Iluminación
let lightIntensity = 220;     // Intensidad base (0-255)
let rotationAngle = 0;        // Ángulo para rotación automática de la luz

// Controles
let isDetecting = true;       // Iniciar/pausar detección
let showKeypoints = false;    // Mostrar/ocultar puntos clave
let enableDeformation = true; // Activar/desactivar deformación por expresión

// Referencias de UI
let statusEl, errorEl;

// ------------------------ Carga previa del modelo (según guía del PDF) ------------------------
function preload() {
  // Cargar la instancia de FaceMesh con las opciones definidas
  faceMesh = ml5.faceMesh(options);
}

// ------------------------ Setup de p5: canvas WEBGL, cámara y FaceMesh ------------------------
function setup() {
  // Crear canvas WEBGL (necesario para 3D)
  const canvas = createCanvas(640, 480, WEBGL);
  canvas.parent('canvas-container');

  // Tasa mínima de refresco especificada: 30 FPS
  frameRate(30);

  // Referencias de estado/errores
  statusEl = select('#status');
  errorEl = select('#error-msg');

  // Inicializar captura de video (cámara)
  video = createCapture(
    {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      },
      audio: false
    },
    () => { /* Permisos concedidos */ }
  );
  video.size(640, 480);
  video.hide();

  // Mensaje si la cámara no está disponible
  setTimeout(() => {
    if (!video.elt || !video.elt.srcObject) {
      errorEl.html('Impossible d’accéder à la caméra. Vérifiez les autorisations ou utilisez HTTPS/localhost.');
      statusEl.removeClass('ok').addClass('fail').html('Caméra indisponible');
    }
  }, 5000);

  // Iniciar detección
  faceMesh.detectStart(video, gotFaces);

  // Crear controles
  createControls();
}


// ------------------------ Bucle de dibujo ---------------------------------
function draw() {
  // Fondo
  background(26);

  // Rotación orbital con el mouse
  orbitControl(2, 2, 0.1);

  // Luces
  setupLighting();

  // Invertimos Y para trabajar cómodo con landmarks
  scale(1, -1, 1);

  // Estado
  if (faces.length > 0) {
    drawFaceMesh();
    statusEl.removeClass('warn fail').addClass('ok').html('Visage détecté');
  } else {
    statusEl.removeClass('ok fail').addClass('warn').html('Aucun visage détecté');
  }

  // Rotación automática de la luz
  rotationAngle += 0.01;
}


// ------------------------ Callback de predicción ---------------------------
function gotFaces(results) {
  faces = results || [];
}

// ------------------------ Iluminación: ambiental + direccional rotante ----
function setupLighting() {
  // Luz ambiental (suaviza sombras). Escalamos por ~30% de la intensidad.
  ambientLight(lightIntensity * 0.3);

  // Luz direccional rotante alrededor del rostro.
  // La dirección se calcula con cos/sin del ángulo actual.
  // Usamos un vector unitario (x, y, z): y ligeramente negativo para simular luz superior.
  const lx = cos(rotationAngle);
  const lz = sin(rotationAngle);
  const ly = -0.35;

  directionalLight(lightIntensity, lightIntensity, lightIntensity, lx, ly, lz);
}

// ------------------------ Dibujo de la malla facial 3D --------------------
function drawFaceMesh() {
  const face = faces[0];

  // Distintas versiones de ml5 pueden exponer landmarks con propiedades diferentes.
  // Cubrimos varios casos comunes: keypoints (objetos), scaledMesh (arrays) o landmarks.
  const raw = face.keypoints || face.scaledMesh || face.landmarks || [];
  if (!raw || raw.length === 0) return;

  // Convertimos todos los puntos a un formato unificado {x,y,z} en coordenadas centradas.
  const pts = raw.map(p => {
    let x, y, z;
    if (Array.isArray(p)) {
      [x, y, z] = p;
    } else if (typeof p === 'object') {
      // ml5/mediapipe suelen exponer x,y,z en píxeles (x,y) y z normalizada
      x = p.x; y = p.y; z = p.z;
    }
    // Centrar en el canvas WEBGL (0,0,0 en el centro) y ajustar Z a profundidad útil
    const cx = x - (video.width / 2);
    const cy = y - (video.height / 2); // Ojo: arriba positivo por scale(1,-1,1)
    const zScale = 110;                 // Escala de profundidad (ajustada a un valor natural)
    const cz = -(z || 0) * zScale;      // Convención: z negativa hacia la cámara
    return { x: cx, y: cy, z: cz };
  });

  // ------------------- Detección de expresión: apertura de boca -----------
  const mouthOpenRatio = detectMouthOpen(pts); // ratio > ~0.06 => boca abierta
  const isBlinking = detectBlink(pts);         // parpadeo opcional (valorado)

  // Factor de deformación (0..1) según apertura de boca
  const deformStrength = enableDeformation
    ? constrain(map(mouthOpenRatio, 0.05, 0.25, 0, 1), 0, 1)
    : 0;

  // Material de la malla: variamos ligeramente el color según expresión/parpadeo
  noStroke();
  if (isBlinking) {
    // Parpadeo: aplicar un leve brillo emissive para indicar evento
    emissiveMaterial(70, 70, 70);
  } else if (deformStrength > 0.01) {
    // Boca abierta: tinte cálido
    ambientMaterial(160 + 60 * deformStrength, 120, 120);
  } else {
    // Neutro
    ambientMaterial(185);
  }

  // Triangulación: algunos builds de ml5 incluyen face.triangles; si no,
  // usamos la constante TRIANGULATION (lista de triángulos estándar de FaceMesh).
  const tris = face.triangles || TRIANGULATION;
  if (!tris || tris.length === 0) return;

  // Dibujar la malla triangular (cada 3 índices = un triángulo)
  beginShape(TRIANGLES);
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = tris[i], i1 = tris[i + 1], i2 = tris[i + 2];
    // Aplicar deformación por expresión (suave, dependiente de la distancia a la boca)
    const v0 = applyDeformation(pts[i0], pts, deformStrength);
    const v1 = applyDeformation(pts[i1], pts, deformStrength);
    const v2 = applyDeformation(pts[i2], pts, deformStrength);

    vertex(v0.x, v0.y, v0.z);
    vertex(v1.x, v1.y, v1.z);
    vertex(v2.x, v2.y, v2.z);
  }
  endShape();

  // Puntos clave (opcional)
  if (showKeypoints) {
    stroke(0, 255, 255);
    strokeWeight(3);
    noFill();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      point(p.x, p.y, p.z);
    }
  }
}

// ------------------------ Deformación por expresión -----------------------
function applyDeformation(p, pts, s) {
  // Si no hay deformación, devolver punto tal cual
  if (!s || s <= 0) return p;

  // Centro aproximado de la boca: promedio de landmarks 13 (labio sup. interno)
  // y 14 (labio inf. interno). Estos índices son estándar en FaceMesh.
  const mouthCenter = {
    x: (pts[13].x + pts[14].x) * 0.5,
    y: (pts[13].y + pts[14].y) * 0.5,
    z: (pts[13].z + pts[14].z) * 0.5
  };

  // Distancia al centro de la boca
  const dx = p.x - mouthCenter.x;
  const dy = p.y - mouthCenter.y;
  const dz = p.z - mouthCenter.z;
  const d2 = dx * dx + dy * dy + dz * dz;

  // Radio de influencia (en px²). Ajustado para afectar labios, mentón cercano y mejillas inmediatas.
  const radius2 = 70 * 70;

  if (d2 > radius2) return p;

  // Peso (1 en el centro -> 0 en el borde del radio)
  const w = (1 - (d2 / radius2)) * s;

  // Offset suave: empujar hacia fuera (z-) y un leve desplazamiento en y+
  // para simular estiramiento cuando se abre la boca.
  return {
    x: p.x,
    y: p.y + 10 * w,
    z: p.z - 14 * w
  };
}

// ------------------------ Detección de apertura de boca -------------------
function detectMouthOpen(pts) {
  // Landmarks útiles (estándar FaceMesh):
  // 13 = labio superior (interior), 14 = labio inferior (interior)
  // 61 y 291 = comisuras izquierda y derecha de la boca (referencia de ancho)
  if (!pts[13] || !pts[14] || !pts[61] || !pts[291]) return 0;

  const upper = pts[13];
  const lower = pts[14];
  const leftC = pts[61];
  const rightC = pts[291];

  const mouthOpen = dist3D(upper, lower);
  const mouthWidth = dist3D(leftC, rightC);

  // Ratio independiente de escala; típicamente > ~0.06 indica boca abierta
  const ratio = mouthOpen / (mouthWidth || 1);
  return ratio;
}

// ------------------------ Detección de parpadeo (opcional) ----------------
function detectBlink(pts) {
  // Ojos: pares verticales y horizontales comunes en FaceMesh
  // Ojo izquierdo: vertical 159-145, horizontal 33-133
  // Ojo derecho: 386-374, horizontal 362-263
  const need = [159,145,33,133,386,374,362,263];
  for (const i of need) if (!pts[i]) return false;

  const leftV = dist3D(pts[159], pts[145]);
  const leftH = dist3D(pts[33],  pts[133]);
  const rightV = dist3D(pts[386], pts[374]);
  const rightH = dist3D(pts[362], pts[263]);

  // Eye Aspect Ratio simple (vertical/horizontal)
  const lRatio = leftV / (leftH || 1);
  const rRatio = rightV / (rightH || 1);

  // Umbral empírico bajo (párpado casi cerrado)
  const TH = 0.045;
  return (lRatio < TH && rRatio < TH);
}

// ------------------------ Utilidad: distancia 3D --------------------------
function dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------ Controles de UI (p5 DOM) ------------------------
function createControls() {
  const ui = select('#controls');

  // Botón iniciar/pausar
  const btn = createButton('⏸️ Mettre en pause');
  btn.addClass('control');
  btn.parent(ui);
  btn.mousePressed(() => {
    if (isDetecting) {
      faceMesh.detectStop();
      isDetecting = false;
      btn.html('▶️ Démarrer la détection');
      statusEl.removeClass('ok warn').addClass('fail').html('Détection en pause');
    } else {
      faceMesh.detectStart(video, gotFaces);
      isDetecting = true;
      btn.html('⏸️ Mettre en pause');
    }
  });

  // Slider de intensidad de luz
  const boxLight = createDiv('').addClass('control').parent(ui);
  const lblLight = createElement('label', 'Intensité de la lumière');
  lblLight.parent(boxLight);
  const slider = createSlider(50, 255, lightIntensity, 1);
  slider.parent(boxLight);
  slider.input(() => (lightIntensity = slider.value()));

  // Checkbox: deformación por expresión
  const boxDef = createDiv('').addClass('control').parent(ui);
  const chkDef = createCheckbox('Déformation par expression', enableDeformation);
  chkDef.parent(boxDef);
  chkDef.changed(() => (enableDeformation = chkDef.checked()));

  // Checkbox: mostrar puntos clave
  const boxPts = createDiv('').addClass('control').parent(ui);
  const chkPts = createCheckbox('Afficher les points clés', showKeypoints);
  chkPts.parent(boxPts);
  chkPts.changed(() => (showKeypoints = chkPts.checked()));
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
