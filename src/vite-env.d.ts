/// <reference types="vite/client" />

/**
 * Build stamp injected by vite (`define` in vite.config.ts): "<short-sha>[+dirty] · <ISO
 * minute>Z". Rendered in the posture strip's audit drawer so the panel can state which
 * build is loaded — the loaded extension is a copy of dist/, and "is this the code I just
 * changed?" was costing real misdiagnoses.
 */
declare const __PILOT_BUILD__: string;
