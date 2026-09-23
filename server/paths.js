import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.BORSA_DATA_DIR || path.join(ROOT, 'data');
// Paketlenmiş uygulamada (DMG) veri ve çalışma alanı ~/Library/Application Support altındadır; uygulama bu değişkenlerle bildirir
export const WORKSPACE_DIR = process.env.BORSA_WORKSPACE_DIR || path.join(ROOT, 'workspace');
export const REPORTS_DIR = path.join(WORKSPACE_DIR, 'reports');
export const WEB_DIR = path.join(ROOT, 'web');
