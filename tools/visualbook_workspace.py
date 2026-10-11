"""Keep frozen tool copies under one repository work budget and serial lock."""
import json
from pathlib import Path

def workspace_root(tool_root):
    tool_root=Path(tool_root).resolve()
    manifest=tool_root/'toolchain.json'
    if not manifest.exists():return tool_root
    data=json.loads(manifest.read_text())
    workspace=Path(data.get('workspace',str(tool_root))).resolve()
    if workspace==tool_root:return tool_root  # Legacy snapshot, local scope retained.
    if not tool_root.is_relative_to(workspace/'work') or not (workspace/'.git').exists():
        raise ValueError('Frozen tools must be inside the recorded repository work/ directory')
    return workspace
