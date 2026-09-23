import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.BORSA_DATA_DIR || path.join(ROOT, 'data');
export const WORKSPACE_DIR = path.join(ROOT, 'workspace');
export const REPORTS_DIR = path.join(WORKSPACE_DIR, 'reports');
export const WEB_DIR = path.join(ROOT, 'web');
