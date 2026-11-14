"""Curate the CC0 Standard village pack's decorative architecture at 256px."""
import importlib.util
from pathlib import Path
import sys
import zipfile

spec = importlib.util.spec_from_file_location("quaternius_import", Path(__file__).with_name("import-quaternius.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
models = ["Roof_Dormer_RoundTile", "Roof_Tower_RoundTiles", "Roof_Wooden_2x1", "Prop_Support",
          "Wall_Arch", "DoorFrame_Round_Brick", "Door_1_Round", "Prop_Vine4", "Balcony_Cross_Straight"]
destination = module.ROOT / "quaternius-village"
with zipfile.ZipFile(sys.argv[1]) as archive:
    for name in models:
        source = next(path for path in archive.namelist() if path.endswith(f"/glTF/{name}.gltf"))
        module.convert(archive, source, destination / f"{name}.glb", 256)
