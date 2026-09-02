# Grabador de pantalla

App Flask para grabar la pantalla del PC desde el navegador, con tres modos:

- **Pantalla completa**: un monitor entero
- **Navegador**: pestaña o ventana del navegador
- **Selección**: dibujas un rectángulo y se graba solo esa zona

## Requisitos

- Python 3.10+
- Chrome o Edge (recomendado). Debe abrirse en `http://127.0.0.1` o HTTPS.

## Uso

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Si no tienes `python3-venv` (Debian/Ubuntu: `sudo apt install python3-venv`), usa el arranque incluido:

```bash
chmod +x run.sh
./run.sh
```

Abre [http://127.0.0.1:5000](http://127.0.0.1:5000).

1. Elige un modo.
2. Pulsa **Grabar** y acepta el permiso de captura.
3. En modo selección, arrastra un rectángulo y pulsa **Confirmar zona y grabar**.
4. Pulsa **Detener**. El vídeo se guarda en `recordings/` como `.webm`.
