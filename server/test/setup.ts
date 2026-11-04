import { wireModules } from '../src/platform/modules.js';

// Tests call use cases directly (settle, reconcilePending...) as well as through the app, so the modules are wired the
// way production wires them before any test runs (see platform/modules.ts).
wireModules();
