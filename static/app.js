const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const preview = document.getElementById("preview");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("download");
const liveBadge = document.getElementById("live-badge");
const recordingsEl = document.getElementById("recordings");
const modeHintEl = document.getElementById("mode-hint");
const modeInputs = document.querySelectorAll('input[name="mode"]');

let recorder = null;
let chunks = [];
let captureStream = null;
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
  const selected = document.querySelector('input[name="mode"]:checked');
  return selected ? selected.value : "fullscreen";
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateHint() {
  if (!modeHintEl) return;
  const m = mode();
  if (m === "window") {
    modeHintEl.innerHTML = `Modo <strong>Navegador</strong>: En el diálogo de captura selecciona la pestaña <strong>"Ventana"</strong> y elige tu navegador. Al cambiar de pestañas se grabará todo lo que ocurra en esa ventana.`;
  } else {
    modeHintEl.innerHTML = `Modo <strong>Pantalla completa</strong>: Capturará todo lo que se vea en el monitor seleccionado.`;
  }
}

modeInputs.forEach((input) => {
  input.addEventListener("change", updateHint);
});
updateHint();

function mimeType() {
  const types = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4;codecs=avc1,opus",
    "video/mp4;codecs=avc1",
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=h264,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function displayMediaOptions() {
  const m = mode();
  if (m === "window") {
    return {
      video: { displaySurface: "window", cursor: "always" },
      audio: true,
      preferCurrentTab: false,
    };
  }
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

  let serverItems = [];
  try {
    const res = await fetch("/api/recordings");
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("application/json")) {
      serverItems = await res.json();
    }
  } catch {
    // Silencioso en entornos estáticos como Vercel
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

startBtn.onclick = async () => {
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
      startBtn.disabled = false;
      setStatus("Captura finalizada");
    }
  });

  const label = mode() === "window" ? "Grabando navegador (todas las pestañas)…" : "Grabando pantalla completa…";
  setStatus(label);
  startRecorder(captureStream);
};

stopBtn.onclick = () => {
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

  const mime = mimeType() || "video/mp4";
  const blob = new Blob(chunks, { type: mime });
  const timestamp = new Date();
  const dateStr = timestamp.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const name = `grabacion-${mode()}-${Date.now()}.mp4`;

  const localUrl = URL.createObjectURL(blob);
  preview.srcObject = null;
  preview.src = localUrl;
  preview.controls = true;

  downloadLink.href = localUrl;
  downloadLink.download = name;
  downloadLink.hidden = false;
  downloadLink.textContent = `Descargar ${name}`;

  // Descarga automática inmediata en formato .mp4
  try {
    const a = document.createElement("a");
    a.href = localUrl;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
    }, 150);
  } catch (err) {
    console.warn("No se pudo iniciar la descarga automática:", err);
  }

  try {
    await saveToDB({
      id: Date.now(),
      name: name,
      size: blob.size,
      date: dateStr,
      blob: blob
    });
    setStatus(`¡Grabación finalizada y descargada (${name})!`);
  } catch (err) {
    console.warn("No se pudo guardar en almacenamiento local:", err);
    setStatus(`Descarga iniciada: ${name}`);
  }

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
