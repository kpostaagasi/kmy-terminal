// İngilizce sözlük: modül başına bir dosya (anahtar = Türkçe kaynak metin)
import core from './en/core.js';
import app from './en/app.js';
import chat from './en/chat.js';
import market from './en/market.js';
import portfolio from './en/portfolio.js';
import settings from './en/settings.js';
import panels from './en/panels.js';
import server, { patterns as serverPatterns } from './en/server.js';

export default { ...server, ...core, ...app, ...panels, ...market, ...portfolio, ...settings, ...chat };
export const patterns = serverPatterns || [];
