# Escaneo Facial 3D Interactivo (p5.js + ml5.js)

Proyecto web listo para usar que **detecta 468 puntos faciales** con **ml5.js FaceMesh** y los **renderiza como malla 3D** en **p5.js (WEBGL)**, mostrando **el video y la malla al mismo tiempo**. **No hay opciones** (UI) y **la cámara se inicia automáticamente**.

> **Nota:** Por seguridad del navegador, el acceso a cámara requiere **HTTPS** o **`http://localhost`**. Abrir el `index.html` con doble clic (protocolo `file://`) normalmente bloqueará la cámara.

---

## Estructura del proyecto

```
facemesh-3d-proyecto/
├─ index.html
├─ sketch.js
├─ style.css
└─ README.md
```

---

## Instalación / Ejecución

1. Descomprime el ZIP.
2. **Opción A (recomendada):** Servidor local simple.
   - Con Python 3:
     ```bash
     cd facemesh-3d-proyecto
     python -m http.server 5500
     ```
     Abre: http://localhost:5500/
   - Con VS Code: extensión **Live Server** → “Open with Live Server”.
3. **Opción B (hosting):** Sube la carpeta a un hosting con **HTTPS** y abre `index.html`.

> Si el navegador pide permisos de cámara, **acéptalos**.

---

## Cómo usar

- Al abrir la página, la **cámara se activa automáticamente**.
- Verás el **video de la webcam** y, encima, la **malla 3D** del rostro.
- La luz direccional **rota automáticamente** para dar volumen.
- **Deformación por expresión:** al **abrir la boca**, una zona de la malla cerca de la boca **se eleva** (efecto sutil) y cambia el color.
- **Parpadeo (opcional):** si parpadeas, el color de la malla **parpadea en dorado** brevemente.

> Para mejor alineación del video y la malla, **no** se permite rotación orbital manual.

---

## Tecnologías utilizadas

- **p5.js** (WEBGL) — v1.9.0
- **ml5.js** — v1.x (modelo FaceMesh de 468 puntos)
- **Delaunator** — triangulación 2D rápida (se calcula una sola vez)

---

## Manejo de errores

- Si no se detecta cámara o permisos, se muestra el estado **“No se pudo acceder a la cámara”**.
- El indicador de estado en la parte superior informa: *Inicializando*, *Buscando rostro*, *Rostro detectado*, etc.

---

## Compatibilidad

Probado en las últimas versiones de **Chrome**, **Firefox** y **Edge** (escritorio). En móvil iOS/Android, usa HTTPS y permite cámara.

---

## Créditos

- [p5.js](https://p5js.org/)
- [ml5.js](https://ml5js.org/)

---

## Checklist de verificación

- [x] El proyecto se ejecuta sin errores en el navegador
- [x] La cámara se activa correctamente
- [x] Los 468 puntos faciales se detectan
- [x] La malla 3D se renderiza correctamente
- [x] La iluminación es visible y rotante
- [x] La deformación por expresión funciona
- [x] Sin opciones/UI — todo automático
- [x] Código limpio y comentado
- [x] Todos los archivos incluidos
