# Pinned renderer dependency

roughjs-4.6.6.cjs is the unmodified bundled CommonJS generator from roughjs 4.6.6, matching web/package-lock.json. Source: https://registry.npmjs.org/roughjs/-/roughjs-4.6.6.tgz. SHA-256: f10ad1eacdb19b1a837ad311f80de596ef206046247a3fae9951d8f2adc59e36. MIT notices (including renderer dependencies) are distributed in web/public/licenses/roughjs.txt.

The Rust export worker evaluates this fixed generator and the tracked web/src/whiteboard-render-core.js, never caller-supplied JavaScript. Keep them aligned with the browser and rerun path/text/PNG parity tests on upgrade. Liberation Sans is bundled unmodified under its SIL OFL notice in web/public/licenses/liberation-sans.txt. There is no Node/Chromium runtime dependency.
