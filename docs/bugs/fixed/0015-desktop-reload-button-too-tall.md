# Bug 0015: Desktop reload control taller than header neighbors

Found: 2026-11-06
State: fixed
Fixed: 2026-11-06

The reload control's unconditional 44px square was chosen for mobile touch access. Desktop notification/settings/workspace buttons are about 28–30px and the theme selector 32px, so reload visibly protrudes. Scope consistent 32px controls to desktop fine-pointer layouts, while retaining the 44px reload target on touch clients and existing confirmation behavior. Task 0024.

Desktop fine-pointer layouts above 900px now share 32px navigation/action controls; reload is a centered 32px square with a 20px glyph. Touch reload remains 44px at narrow and wide widths. Measured bounds/centers at 1280/1440/1920 and touch 393/1440 pass; confirmation/cancel/mobile reload and tmux-preservation checks pass. Synthetic screenshot reviewed; frontend deployed.
