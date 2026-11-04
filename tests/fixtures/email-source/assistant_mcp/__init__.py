# Isolate the fake Google package from site-installed namespace packages.
import sys
sys.modules.pop('google',None)
