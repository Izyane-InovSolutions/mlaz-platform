import { portal } from './api.js';

// The latest member summary, refreshed by the router on every portal page (for the sidebar badge and the header).
export let ME = null;
export async function refreshMember() { try { ME = await portal('/profile'); } catch (e) { /* keep the last one */ } return ME; }
