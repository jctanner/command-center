# Tmux view maximize

Task [0074](../tasks/done/0074-tmux-view-maximize.md) adds a browser-local maximize/restore control to the session/window toolbar. It hides global navigation and machine tabs, preserves the viewer and native pane zoom, and resets on workspace exit or compact layout. TypeScript/Vite build and three isolated tmux browser tests passed. Frontend staged in web/dist-next; no deployment, commit or push authorized/performed. Backend unchanged.

Human subsequently authorized commit/push/deploy. Implementation `93074b8` pushed; frontend-only deployment verified across four access paths, with backend/config/tmux pane PIDs unchanged. No restart. Reload once.
