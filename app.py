from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
RECORDINGS = Path(__file__).resolve().parent / "recordings"
RECORDINGS.mkdir(exist_ok=True)
ALLOWED_EXT = {".webm", ".mp4"}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/recordings")
def list_recordings():
    files = sorted(RECORDINGS.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    items = [
        {"name": f.name, "size": f.stat().st_size}
        for f in files
        if f.is_file() and f.suffix.lower() in ALLOWED_EXT
    ]
    return jsonify(items)


@app.post("/save")
def save():
    video = request.files.get("video")
    if not video or not video.filename:
        return jsonify({"ok": False, "error": "No hay vídeo"}), 400

    name = secure_filename(video.filename)
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_EXT:
        return jsonify({"ok": False, "error": "Formato no permitido"}), 400

    dest = RECORDINGS / name
    video.save(dest)
    return jsonify({"ok": True, "filename": dest.name})


@app.get("/recordings/<path:name>")
def download(name):
    safe = secure_filename(name)
    path = RECORDINGS / safe
    if not path.is_file():
        return jsonify({"ok": False, "error": "No encontrado"}), 404
    return send_from_directory(RECORDINGS, safe, as_attachment=True)


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
