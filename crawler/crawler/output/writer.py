"""Write JSON output files to the data/ directory."""

import json
from pathlib import Path


def write_json_output(data_dir: Path, files: dict[str, dict]):
    """Write multiple JSON files to the data directory."""
    data_dir.mkdir(parents=True, exist_ok=True)

    for filename, data in files.items():
        path = data_dir / filename
        path.write_text(json.dumps(data, indent=2, default=str, ensure_ascii=False))
        print(f"  Wrote {path} ({path.stat().st_size:,} bytes)")
