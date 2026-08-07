#!/usr/bin/env python3
"""Genere la configuration navigateur utilisable en file://."""

from __future__ import annotations

import argparse
import base64
import csv
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
LOGO_DIR = DATA_DIR / "logos"
OUTPUT = ROOT / "assets" / "js" / "generated-config.js"
SOURCES = {
    "tarifs": DATA_DIR / "tarifs.json",
    "prestations": DATA_DIR / "prestations.json",
    "textes": DATA_DIR / "textes.json",
    "catalogMetadata": DATA_DIR / "metadata_icones_corrigees.json",
}
LOGO_PATTERNS = ("*.png", "*.jpg", "*.jpeg", "*.webp")
FOOTER_BANNER = LOGO_DIR / "bandeau.png"
LABORATORIES_CSV = DATA_DIR / "labos.csv"
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
        for path in sorted(LOGO_DIR.glob(pattern)):
            if path.resolve() == FOOTER_BANNER.resolve():
                continue
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


def read_footer_banner() -> str:
    if not FOOTER_BANNER.exists():
        raise SystemExit(f"Bandeau PDF introuvable: {FOOTER_BANNER}")
    if FOOTER_BANNER.suffix.lower() != ".png":
        raise SystemExit(f"Le bandeau PDF doit etre un PNG: {FOOTER_BANNER}")
    source_bytes = FOOTER_BANNER.read_bytes()
    encoded = base64.b64encode(source_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def read_laboratories(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"CSV laboratoires introuvable: {path}")
    rows: list[dict] = []
    seen_codes: set[str] = set()
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        expected = ["COD_SEGMENT", "Labo", "Code"]
        if reader.fieldnames != expected:
            raise SystemExit(
                f"Colonnes invalides dans {path}: {reader.fieldnames}. "
                f"Colonnes attendues: {expected}"
            )
        for index, row in enumerate(reader, start=2):
            segment_code = (row.get("COD_SEGMENT") or "").strip()
            label = (row.get("Labo") or "").strip()
            code = (row.get("Code") or "").strip()
            if not label:
                raise SystemExit(f"Libelle laboratoire vide ligne {index} dans {path}")
            if not code:
                raise SystemExit(f"Code laboratoire vide ligne {index} dans {path}")
            if code in seen_codes:
                raise SystemExit(f"Code laboratoire duplique dans {path}: {code}")
            seen_codes.add(code)
            rows.append({"segmentCode": segment_code, "label": label, "code": code})
    if len(rows) != 42:
        raise SystemExit(f"{path} doit contenir exactement 42 laboratoires, lu: {len(rows)}")
    if not any(row["code"] == "Autre" and row["label"] == "Autre" for row in rows):
        raise SystemExit(f"{path} doit contenir une option Autre")
    return rows


def build_content() -> str:
    config = {key: read_json(path) for key, path in SOURCES.items()}
    config["laboratories"] = read_laboratories(LABORATORIES_CSV)
    config["assets"] = {"logos": read_logos(), "images": {"footerBanner": read_footer_banner()}}
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
                "assets/js/generated-config.js n'est plus synchronise avec les JSON, les logos, le bandeau ou data/labos.csv. "
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
