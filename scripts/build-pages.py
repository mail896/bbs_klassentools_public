"""Publish only the project site, screenshots and static demo. Never copy backend/config."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
out=root/'dist/pages'
if out.exists(): shutil.rmtree(out)
out.mkdir(parents=True)
shutil.copytree(root/'site',out,dirs_exist_ok=True)
shutil.copytree(root/'images',out/'images')
shutil.copytree(root/'public',out/'demo')
p=out/'demo/index.html'
s=p.read_text().replace('<html lang="de"','<html data-demo-only="true" lang="de"')
s=s.replace('<meta charset="utf-8" />', '<meta charset="utf-8" /><meta name="robots" content="noindex" />')
s=s.replace('Keine Speicherung von IP-Adressen.', 'Keine eigene Nutzungsstatistik. Hosting durch GitHub Pages.')
p.write_text(s)
(out/'.nojekyll').touch()
print(out)
