const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const preview = document.getElementById("preview");
const statusEl = document.getElementById("status");
const overlay = document.getElementById("overlay");
const cropCanvas = document.getElementById("crop");
const confirmCrop = document.getElementById("confirm-crop");
const downloadLink = document.getElementById("download");
const liveBadge = document.getElementById("live-badge");
const recordingsEl = document.getElementById("recordings");
const modeHintEl = document.getElementById("mode-hint");
const modeInputs = document.querySelectorAll('input[name="mode"]');

let recorder = null;
let chunks = [];
let captureStream = null;
let cropRect = null;
let drawLoop = 0;
let recording = false;

// --- Almacenamiento local seguro con IndexedDB ---
const DB_NAME = "ScreenRecorderDB";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveToDB(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = req.result || [];
      items.sort((a, b) => b.id - a.id);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateHint() {
  if (!modeHintEl) return;
  const m = mode();
  if (m === "window") {
    modeHintEl.innerHTML = `Modo <strong>Ventana (Navegador)</strong>: En el diálogo de captura selecciona la pestaña <strong>"Ventana"</strong> y elige tu navegador. Al cambiar de pestañas se grabará todo lo que hagas dentro de esa ventana.`;
  } else if (m === "tab") {
    modeHintEl.innerHTML = `Modo <strong>Pestaña única</strong>: Graba únicamente una pestaña específica. Si cambias de pestaña, la grabación continuará solo en la pestaña original.`;
  } else if (m === "selection") {
    modeHintEl.innerHTML = `Modo <strong>Selección</strong>: Primero se abrirá la vista previa para que dibujes con el ratón la zona rectangular exacta que deseas grabar.`;
  } else {
    modeHintEl.innerHTML = `Modo <strong>Pantalla completa</strong>: Graba todo lo que ocurra en el monitor seleccionado.`;
  }
}

modeInputs.forEach((input) => {
  input.addEventListener("change", updateHint);
});
updateHint();

function mimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function displayMediaOptions() {
  const m = mode();
  if (m === "window") {
    // Solicita capturar una ventana completa (permite cambiar de pestañas en el navegador)
    return {
      video: { displaySurface: "window", cursor: "always" },
      audio: true,
      preferCurrentTab: false,
    };
  }
  if (m === "tab") {
    // Solicita capturar una pestaña específica
    return {
      video: { displaySurface: "browser", cursor: "always" },
      audio: true,
      preferCurrentTab: false,
      selfBrowserSurface: "include",
    };
  }
  // fullscreen o selection
  return {
    video: { displaySurface: "monitor", cursor: "always" },
    audio: true,
    preferCurrentTab: false,
  };
}

async function refreshRecordings() {
  recordingsEl.innerHTML = "";
  let localItems = [];

  try {
    localItems = await getAllFromDB();
  } catch (err) {
    console.warn("IndexedDB no disponible:", err);
  }

  // Intentamos consultar el backend opcional si corre localmente
  let serverItems = [];
  try {
    const res = await fetch("/api/recordings");
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("application/json")) {
      serverItems = await res.json();
    }
  } catch {
    // Silencioso en modo estático/Vercel
  }

  if (!localItems.length && !serverItems.length) {
    recordingsEl.innerHTML = "<li class='empty-state'>Todavía no hay grabaciones guardadas.</li>";
    return;
  }

  for (const item of localItems) {
    const li = document.createElement("li");
    const mb = (item.size / (1024 * 1024)).toFixed(2);
    const sizeText = item.size >= 1024 * 1024 ? `${mb} MB` : `${Math.max(1, Math.round(item.size / 1024))} KB`;

    li.innerHTML = `
      <div class="rec-info">
        <strong class="rec-title">${item.name}</strong>
        <span class="rec-meta">${sizeText} • ${item.date || "Grabación"}</span>
      </div>
      <div class="rec-actions">
        <button type="button" class="btn-action btn-play" title="Reproducir en pantalla">▶ Ver</button>
        <button type="button" class="btn-action btn-download" title="Descargar archivo">⬇ Descargar</button>
        <button type="button" class="btn-action btn-delete" title="Eliminar grabación">🗑</button>
      </div>
    `;

    const playBtn = li.querySelector(".btn-play");
    const dlBtn = li.querySelector(".btn-download");
    const delBtn = li.querySelector(".btn-delete");

    playBtn.onclick = () => {
      const url = URL.createObjectURL(item.blob);
      preview.srcObject = null;
      preview.src = url;
      preview.controls = true;
      preview.play().catch(() => {});
      downloadLink.href = url;
      downloadLink.download = item.name;
      downloadLink.hidden = false;
      downloadLink.textContent = `Descargar ${item.name}`;
      setStatus(`Reproduciendo: ${item.name}`);
    };

    dlBtn.onclick = () => {
      const url = URL.createObjectURL(item.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    delBtn.onclick = async () => {
      if (confirm(`¿Eliminar "${item.name}"?`)) {
        await deleteFromDB(item.id);
        await refreshRecordings();
      }
    };

    recordingsEl.appendChild(li);
  }

  // Grabaciones adicionales del servidor (si corre con backend Flask local)
  for (const sItem of serverItems) {
    if (localItems.some((l) => l.name === sItem.name)) continue;
    const li = document.createElement("li");
    const kb = Math.max(1, Math.round(sItem.size / 1024));
    li.innerHTML = `
      <div class="rec-info">
        <strong class="rec-title">${sItem.name}</strong>
        <span class="rec-meta">${kb} KB (Servidor)</span>
      </div>
      <div class="rec-actions">
        <a class="btn-action btn-download" href="/recordings/${encodeURIComponent(sItem.name)}" download>⬇ Descargar</a>
      </div>
    `;
    recordingsEl.appendChild(li);
  }
}

function stopCaptureTracks() {
  captureStream?.getTracks().forEach((t) => t.stop());
  captureStream = null;
  if (drawLoop) {
    cancelAnimationFrame(drawLoop);
    drawLoop = 0;
  }
}

function startRecorder(stream) {
  chunks = [];
  const mime = mimeType();
  recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  recorder.onstop = onStop;
  recorder.start(250);
  recording = true;
  liveBadge.hidden = false;
  startBtn.disabled = true;
  stopBtn.disabled = false;
}

function setupCrop() {
  const ctx = cropCanvas.getContext("2d");
  let start = null;

  const syncSize = () => {
    cropCanvas.width = preview.clientWidth || 1280;
    cropCanvas.height = preview.clientHeight || 720;
    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  };
  syncSize();

  const pos = (ev) => {
    const r = cropCanvas.getBoundingClientRect();
    return {
      x: ev.clientX - r.left,
      y: ev.clientY - r.top,
    };
  };

  const toVideoRect = (rect) => {
    const scaleX = preview.videoWidth / cropCanvas.width;
    const scaleY = preview.videoHeight / cropCanvas.height;
    return {
      x: Math.max(0, rect.x * scaleX),
      y: Math.max(0, rect.y * scaleY),
      w: Math.min(preview.videoWidth, rect.w * scaleX),
      h: Math.min(preview.videoHeight, rect.h * scaleY),
    };
  };

  cropCanvas.onmousedown = (ev) => {
    start = pos(ev);
    cropRect = null;
  };
  cropCanvas.onmousemove = (ev) => {
    if (!start) return;
    const p = pos(ev);
    ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.strokeStyle = "#3d9cf0";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y);
  };
  cropCanvas.onmouseup = (ev) => {
    if (!start) return;
    const p = pos(ev);
    const displayRect = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    };
    cropRect = toVideoRect(displayRect);
    start = null;
  };
}

function beginCroppedRecording() {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropRect.w);
  canvas.height = Math.round(cropRect.h);
  const ctx = canvas.getContext("2d");

  const draw = () => {
    if (!recording) return;
    ctx.drawImage(
      preview,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      canvas.width,
      canvas.height
    );
    drawLoop = requestAnimationFrame(draw);
  };

  const cropped = canvas.captureStream(30);
  captureStream.getAudioTracks().forEach((track) => cropped.addTrack(track));
  startRecorder(cropped);
  draw();
  overlay.hidden = true;
  setStatus("Grabando zona seleccionada…");
}

startBtn.onclick = async () => {
  cropRect = null;
  overlay.hidden = true;
  downloadLink.hidden = true;
  preview.controls = false;
  preview.removeAttribute("src");
  preview.srcObject = null;

  try {
    captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions());
  } catch {
    setStatus("Captura cancelada o no permitida");
    return;
  }

  preview.srcObject = captureStream;
  await preview.play().catch(() => {});

  captureStream.getVideoTracks()[0].addEventListener("ended", () => {
    if (recording) stopBtn.click();
    else {
      stopCaptureTracks();
      overlay.hidden = true;
      startBtn.disabled = false;
      setStatus("Captura finalizada");
    }
  });

  if (mode() === "selection") {
    overlay.hidden = false;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Selecciona la zona a grabar con el ratón");
    await new Promise((resolve) => {
      if (preview.readyState >= 1) resolve();
      else preview.onloadedmetadata = resolve;
    });
    setupCrop();
    return;
  }

  let label = "Grabando pantalla completa…";
  if (mode() === "window") label = "Grabando ventana del navegador (todas las pestañas)…";
  else if (mode() === "tab") label = "Grabando pestaña individual…";
  else if (mode() === "selection") label = "Grabando zona seleccionada…";
  setStatus(label);
  startRecorder(captureStream);
};

confirmCrop.onclick = () => {
  if (!cropRect || cropRect.w < 8 || cropRect.h < 8) {
    setStatus("Dibuja un rectángulo primero");
    return;
  }
  beginCroppedRecording();
};

stopBtn.onclick = () => {
  overlay.hidden = true;
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  } else {
    recording = false;
    liveBadge.hidden = true;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    stopCaptureTracks();
    setStatus("Listo");
  }
};

async function onStop() {
  recording = false;
  liveBadge.hidden = true;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  stopCaptureTracks();
  setStatus("Procesando grabación…");

  const mime = mimeType() || "video/webm";
  const blob = new Blob(chunks, { type: mime });
  const timestamp = new Date();
  const dateStr = timestamp.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const name = `grabacion-${mode()}-${Date.now()}.webm`;

  // 1. URL directa para reproducción y descarga inmediata
  const localUrl = URL.createObjectURL(blob);
  preview.srcObject = null;
  preview.src = localUrl;
  preview.controls = true;

  downloadLink.href = localUrl;
  downloadLink.download = name;
  downloadLink.hidden = false;
  downloadLink.textContent = `Descargar ${name}`;

  // 2. Guardar en IndexedDB del navegador
  try {
    await saveToDB({
      id: Date.now(),
      name: name,
      size: blob.size,
      date: dateStr,
      blob: blob
    });
    setStatus("Grabación guardada con éxito");
  } catch (err) {
    console.warn("No se pudo guardar en almacenamiento local:", err);
    setStatus("Grabación lista para descargar");
  }

  // 3. Respaldo opcional en Flask backend si corre localmente
  try {
    const file = new File([blob], name, { type: mime });
    const fd = new FormData();
    fd.append("video", file);

    const res = await fetch("/save", { method: "POST", body: fd });
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("application/json")) {
      const data = await res.json();
      if (data.ok) {
        console.log("Copia guardada en backend:", data.filename);
      }
    }
  } catch {
    // Silencioso en modo estático/Vercel
  }

  await refreshRecordings();
}

refreshRecordings();
