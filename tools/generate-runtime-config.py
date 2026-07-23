#!/usr/bin/env python3
"""Genere la configuration navigateur utilisable en file://."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
from pathlib import Path
import sys
from io import BytesIO

try:
    from PIL import Image
except ImportError:  # pragma: no cover - dependance locale optionnelle
    Image = None

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT = ROOT / "assets" / "js" / "generated-config.js"
SOURCES = {
    "tarifs": DATA_DIR / "tarifs.json",
    "prestations": DATA_DIR / "prestations.json",
    "textes": DATA_DIR / "textes.json",
}
LOGO_PATTERNS = ("*.png", "*.jpg", "*.jpeg", "*.webp")
HEADER = """// Fichier genere automatiquement.
// Ne pas modifier directement.
// Modifier les fichiers de data/ puis relancer tools/generate-runtime-config.py.
"""


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"JSON invalide dans {path}: {error}") from error


def logo_id(path: Path) -> str:
    return (
        path.stem.lower()
        .replace("logo ", "")
        .replace(" ", "_")
        .replace("-", "_")
    )


def resized_png_data_url(source_bytes: bytes, mime: str, max_size: tuple[int, int] = (600, 220)) -> str | None:
    if Image is None:
        return None
    try:
        with Image.open(BytesIO(source_bytes)) as image:
            image.thumbnail(max_size)
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA")
            buffer = BytesIO()
            image.save(buffer, format="PNG", optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception:
        if mime == "image/png":
            encoded = base64.b64encode(source_bytes).decode("ascii")
            return f"data:image/png;base64,{encoded}"
        return None


def read_logos() -> list[dict]:
    logos = []
    for pattern in LOGO_PATTERNS:
        for path in sorted(DATA_DIR.glob(pattern)):
            source_bytes = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if path.suffix.lower() == ".webp" and Image is not None:
                buffer = BytesIO()
                with Image.open(BytesIO(source_bytes)) as image:
                    image.save(buffer, format="PNG")
                source_bytes = buffer.getvalue()
                mime = "image/png"
            encoded = base64.b64encode(source_bytes).decode("ascii")
            pdf_data_url = resized_png_data_url(source_bytes, mime)
            logos.append(
                {
                    "id": logo_id(path),
                    "label": path.stem,
                    "filename": path.name,
                    "mimeType": mime,
                    "dataUrl": f"data:{mime};base64,{encoded}",
                    "pdfDataUrl": pdf_data_url,
                }
            )
    return logos


def build_content() -> str:
    config = {key: read_json(path) for key, path in SOURCES.items()}
    config["assets"] = {"logos": read_logos()}
    payload = json.dumps(config, ensure_ascii=False, indent=2)
    return f"{HEADER}globalThis.NIRS_CONFIG = {payload};\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Genere assets/js/generated-config.js depuis data/*.json.")
    parser.add_argument("--check", action="store_true", help="verifie que generated-config.js est synchronise sans l'ecrire")
    args = parser.parse_args()

    expected = build_content()
    if args.check:
        if not OUTPUT.exists():
            print(f"{OUTPUT} est absent. Relancez python tools/generate-runtime-config.py.", file=sys.stderr)
            return 1
        current = OUTPUT.read_text(encoding="utf-8")
        if current != expected:
            print(
                "assets/js/generated-config.js n'est plus synchronise avec les JSON ou les logos. "
                "Relancez python tools/generate-runtime-config.py.",
                file=sys.stderr,
            )
            return 1
        print("generated-config.js est synchronise.")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(expected, encoding="utf-8", newline="\n")
    print(f"Configuration generee: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
