import json,sys
from pathlib import Path
import cairosvg
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1])
out=root/'public/ui-icons'
out.mkdir(parents=True,exist_ok=True)
mapping=json.loads((root/'scripts/ui-icon-map.json').read_text())
for name, artwork in mapping.items():
    path=source/'icons'/(artwork+'.svg')
    svg=path.read_text().replace('currentColor','#262626')
    cairosvg.svg2png(bytestring=svg.encode(),write_to=str(out/(name+'.png')),output_width=96,output_height=96)
print('Generated',len(mapping),'Lucide PNG icons')
