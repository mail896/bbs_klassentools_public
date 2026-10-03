import os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env=dict(os.environ,KLASSENTOOLS_STAGED_DIR=str(root/'public'))
for name in ['company-ui.cjs','browser.cjs','class-ui.cjs','admin-ui.cjs','landing.cjs','login-ui.cjs','seating.cjs','seating-export.cjs','fullscreen.cjs','photo-flow.mjs','seating-flow.mjs','learning-flow.mjs']:
 subprocess.run(['node','tests/'+name],cwd=root,env=env,check=True)
