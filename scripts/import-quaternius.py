"""Build the curated town-entrance GLBs from Quaternius Standard ZIPs.

Usage: python scripts/import-quaternius.py <nature.zip> <village.zip>
Requires Pillow. Models retain authored normals, UVs and material properties.
Textures are capped at 512px and embedded, so each runtime asset is offline-safe.
"""
import io
import json
from pathlib import Path
import struct
import sys
import zipfile

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public/assets/3d"
PACKS = [
    ("quaternius-nature", [
        "CommonTree_1", "CommonTree_3", "Pine_1", "Fern_1",
        "Grass_Common_Short", "Bush_Common", "Flower_3_Group",
        "Flower_4_Group", "Rock_Medium_1", "Pebble_Round_1",
        "Mushroom_Common", "RockPath_Round_Small_1",
    ]),
    ("quaternius-village", [
        "Roof_RoundTiles_6x6", "Wall_Plaster_Straight",
        "Wall_Plaster_Door_Flat", "Wall_Plaster_Window_Wide_Flat",
        "Door_1_Flat", "WindowShutters_Wide_Flat_Open", "Prop_Chimney",
        "Prop_Crate", "Prop_Wagon", "Prop_Vine1", "Floor_UnevenBrick",
        "Floor_WoodDark", "Prop_WoodenFence_Single",
    ]),
]


def convert(archive, source, target, texture_limit=512):
    document = json.loads(archive.read(source))
    directory = source.rsplit("/", 1)[0]
    binary = bytearray()

    def append(data):
        binary.extend(b"\0" * (-len(binary) % 4))
        offset = len(binary)
        binary.extend(data)
        return offset

    offsets = []
    for buffer in document["buffers"]:
        offsets.append(append(archive.read(f'{directory}/{buffer["uri"]}')))
    for view in document.get("bufferViews", []):
        view["byteOffset"] = view.get("byteOffset", 0) + offsets[view["buffer"]]
        view["buffer"] = 0

    for image in document.get("images", []):
        with Image.open(io.BytesIO(archive.read(f'{directory}/{image.pop("uri")}'))) as texture:
            texture.thumbnail((texture_limit, texture_limit), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            texture.save(encoded, format="PNG", optimize=True)
        data = encoded.getvalue()
        image["bufferView"] = len(document["bufferViews"])
        image["mimeType"] = "image/png"
        document["bufferViews"].append({"buffer": 0, "byteOffset": append(data), "byteLength": len(data)})

    document["buffers"] = [{"byteLength": len(binary)}]
    document["asset"]["copyright"] = "Quaternius — CC0 1.0 Universal"
    encoded_json = json.dumps(document, separators=(",", ":")).encode()
    encoded_json += b" " * (-len(encoded_json) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    data = (struct.pack("<III", 0x46546C67, 2, 28 + len(encoded_json) + len(binary))
            + struct.pack("<II", len(encoded_json), 0x4E4F534A) + encoded_json
            + struct.pack("<II", len(binary), 0x004E4942) + binary)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError(f"Asset exceeds offline cache budget: {target}")
    target.write_bytes(data)
    print(f"{target.name}: {len(data):,} bytes")


if __name__ == "__main__":
    for archive_path, (pack, models) in zip(sys.argv[1:], PACKS, strict=True):
        destination = ROOT / pack
        destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            for name in models:
                source = next(n for n in names if n.endswith(f"/glTF/{name}.gltf") or n == f"glTF/{name}.gltf")
                convert(archive, source, destination / f"{name}.glb")
            license_path = next(n for n in names if n.endswith("License_Standard.txt"))
            (destination / "LICENSE.txt").write_bytes(archive.read(license_path))
