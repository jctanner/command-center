"""Semantic drawing hues, contrast and perceptual separation in every theme."""
import importlib.util,json,unittest,colorsys,itertools,math
from pathlib import Path
ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('tokens',ROOT/'scripts/generate-theme-tokens.py');tokens=importlib.util.module_from_spec(spec);spec.loader.exec_module(tokens)
def oklab(hex):
 r,g,b=[v/255 for v in tokens.rgb(hex)];r,g,b=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in (r,g,b)]
 l=(.4122214708*r+.5363325363*g+.0514459929*b)**(1/3);m=(.2119034982*r+.6806995451*g+.1073969566*b)**(1/3);s=(.0883024619*r+.2817188376*g+.6299787005*b)**(1/3)
 return(.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s)
class DrawingPalette(unittest.TestCase):
 def test_all_themes_have_semantic_contrasted_distinct_named_colors(self):
  themes=json.loads((ROOT/'web/src/theme-palettes.json').read_text())['themes'];drawing=json.loads((ROOT/'web/src/whiteboard-palettes.json').read_text());self.assertEqual(set(drawing),{t['id']for t in themes})
  names=['red','orange','yellow','green','teal','blue','purple','magenta','gray'];ranges={'red':(340,25),'orange':(20,45),'yellow':(45,70),'green':(85,145),'teal':(155,195),'blue':(200,235),'purple':(245,285),'magenta':(295,335)}
  for theme in themes:
   c=theme['colors'];p=drawing[theme['id']];self.assertEqual(p,tokens.whiteboard_palette(c,tokens.tokens(c)));self.assertEqual(p['ink'],c['foreground']);self.assertEqual(p['accent'],c['accent'])
   for name in names:
    h,s,_=colorsys.rgb_to_hsv(*(v/255 for v in tokens.rgb(p[name])));h*=360
    if name=='gray':self.assertLess(s,.03,(theme['id'],name,p[name]))
    else:
     lo,hi=ranges[name];self.assertTrue((h>=lo or h<=hi)if lo>hi else lo<=h<=hi,(theme['id'],name,p[name],h));self.assertGreater(s,.2,(theme['id'],name))
    self.assertGreaterEqual(tokens.contrast(p[name],p['background']),4.5,(theme['id'],name,'background'));self.assertGreaterEqual(tokens.contrast(p[name],p[name+'_soft']),4.5,(theme['id'],name,'soft fill'))
   for a,b in itertools.combinations(names,2):self.assertGreaterEqual(math.dist(oklab(p[a]),oklab(p[b])),.08,(theme['id'],a,b,p[a],p[b]))
if __name__=='__main__':unittest.main()
