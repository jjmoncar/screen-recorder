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

let recorder = null;
let chunks = [];
let captureStream = null;
let cropRect = null;
let drawLoop = 0;
let recording = false;

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function setStatus(text) {
  statusEl.textContent = text;
}

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
  if (m === "browser") {
    return {
      video: { displaySurface: "browser", cursor: "always" },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
    };
  }
  return {
    video: { displaySurface: "monitor", cursor: "always" },
    audio: true,
    preferCurrentTab: false,
  };
}

async function refreshRecordings() {
  const res = await fetch("/api/recordings");
  const items = await res.json();
  recordingsEl.innerHTML = "";
  if (!items.length) {
    recordingsEl.innerHTML = "<li>Todavía no hay grabaciones.</li>";
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const kb = Math.max(1, Math.round(item.size / 1024));
    li.innerHTML = `<span>${item.name}</span><a href="/recordings/${encodeURIComponent(item.name)}">${kb} KB — descargar</a>`;
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
    setStatus("Selecciona la zona a grabar");
    await new Promise((resolve) => {
      if (preview.readyState >= 1) resolve();
      else preview.onloadedmetadata = resolve;
    });
    setupCrop();
    return;
  }

  const label = mode() === "browser" ? "Grabando navegador…" : "Grabando pantalla completa…";
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
  setStatus("Guardando…");

  const blob = new Blob(chunks, { type: "video/webm" });
  const name = `grabacion-${mode()}-${Date.now()}.webm`;
  const file = new File([blob], name, { type: "video/webm" });
  const fd = new FormData();
  fd.append("video", file);

  try {
    const res = await fetch("/save", { method: "POST", body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Error al guardar");

    const url = URL.createObjectURL(blob);
    preview.srcObject = null;
    preview.src = url;
    downloadLink.href = `/recordings/${encodeURIComponent(data.filename)}`;
    downloadLink.hidden = false;
    downloadLink.textContent = `Descargar ${data.filename}`;
    setStatus("Guardado");
    await refreshRecordings();
  } catch (err) {
    setStatus(err.message || "No se pudo guardar");
  }
}

refreshRecordings();
