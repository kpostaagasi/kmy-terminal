// Sohbette plan seçilince giden izin kipi plan olur.
import assert from 'node:assert/strict';
import { selectChatPerm, chatPermMode } from '../web/js/chat-perm.js';

assert.equal(chatPermMode(), 'default');
selectChatPerm('plan');
assert.equal(chatPermMode(), 'plan');
assert.notEqual(chatPermMode(), 'default');
selectChatPerm('/plan');
assert.equal(chatPermMode(), 'plan');
console.log('ok sohbet plan');
