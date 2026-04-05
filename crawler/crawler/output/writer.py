"""Write JSON output files to the data/ directory."""

import json
from pathlib import Path


def write_json_output(data_dir: Path, files: dict[str, dict]):
    """Write multiple JSON files to the data directory.

    Safety: refuses to overwrite a file >100KB with data <1KB to prevent
    accidental data loss from empty crawl results.
    """
    data_dir.mkdir(parents=True, exist_ok=True)

    for filename, data in files.items():
        path = data_dir / filename
        new_content = json.dumps(data, indent=2, default=str, ensure_ascii=False)

        # Safety check: don't overwrite large files with tiny data
        if path.exists():
            existing_size = path.stat().st_size
            if existing_size > 100_000 and len(new_content) < 1_000:
                print(f"  SKIPPED {path}: existing file is {existing_size:,} bytes but new data is only {len(new_content):,} bytes (safety check)")
                continue

        path.write_text(new_content, encoding='utf-8')
        print(f"  Wrote {path} ({path.stat().st_size:,} bytes)")
