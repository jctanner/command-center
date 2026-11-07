# Third-party notices

Omarchy color palette data in `web/src/theme-palettes.json` is derived from [Omarchy](https://github.com/omacom/omarchy), pinned to commit `14abc0762ce38547d1912061969df58962f6f10a` (`themes/*/colors.toml`). The original [MIT notice](omarchy-LICENSE.txt) is retained. CC adapts palette values for its own UI, editors and terminal renderer; it does not distribute desktop configs, wallpapers, fonts or executable theme code.

The notice is also shipped in built web assets at `/licenses/omarchy.txt`. `python3 scripts/generate-theme-tokens.py` regenerates semantic CSS tokens and that license copy from the pinned data. UI text/status colors are adjusted for contrast; terminal ANSI colors retain the source palette.
