import '@fontsource-variable/inter';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/styles.scss';
import 'bootstrap';
import { start } from './app/router.js';
import { watchLabels } from './shared/ui/index.js';

// The prototype kept sample data in this browser; it is no longer used, so clear it out.
try { localStorage.removeItem('mlaz-demo-v3'); indexedDB.deleteDatabase('mlaz-docs'); } catch (e) { /* ignore */ }

watchLabels();
start();
