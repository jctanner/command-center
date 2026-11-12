"""Generated drawing tokens: contrast, legacy appearance and deterministic catalog."""
import importlib.util,json,unittest,colorsys
from pathlib import Path
ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('tokens',ROOT/'scripts/generate-theme-tokens.py');tokens=importlib.util.module_from_spec(spec);spec.loader.exec_module(tokens)
class DrawingPalette(unittest.TestCase):
 def test_all_themes_keep_old_five_and_supply_contrasted_new_strokes(self):
  themes=json.loads((ROOT/'web/src/theme-palettes.json').read_text())['themes'];drawing=json.loads((ROOT/'web/src/whiteboard-palettes.json').read_text());self.assertEqual(set(drawing),{t['id']for t in themes})
  for theme in themes:
   colors=theme['colors'];p=drawing[theme['id']];self.assertEqual(p,tokens.whiteboard_palette(colors,tokens.tokens(colors)))
   for name,key in [('ink','foreground'),('accent','accent'),('blue','blue'),('magenta','magenta'),('yellow','yellow')]:self.assertEqual(p[name],colors[key],(theme['id'],name))
   hue,saturation,_=colorsys.rgb_to_hsv(*(v/255 for v in tokens.rgb(p['red'])))
   self.assertGreaterEqual(saturation,.2,theme['id']);self.assertTrue(hue<=25/360 or hue>=340/360,(theme['id'],p['red']))
   for name in ['red','orange','green','teal','purple','gray']:
    self.assertGreaterEqual(tokens.contrast(p[name],p['background']),4.5,(theme['id'],name,'background'))
    self.assertGreaterEqual(tokens.contrast(p[name],p[name+'_soft']),4.5,(theme['id'],name,'soft fill'))
if __name__=='__main__':unittest.main()
