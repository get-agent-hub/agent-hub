# UI mockups

Static HTML templates for the future `ahub ui` (local web UI, DSH-like). No build step.
Data is a snapshot of a real `ahub status`, hard-coded.

```bash
cd ui/mockups && python3 -m http.server 8765   # open http://127.0.0.1:8765
```

Screens: Overview · Skills · MCP servers · Instructions · Memory · Repos & tasks · Sessions (v0.2 preview).
Shared: `../app/base.css` (tokens, dark/light), `nav.js` (injects sidebar).
