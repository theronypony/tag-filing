import { afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Modal, Notice } from './stubs/obsidian';

vi.stubGlobal('window', globalThis);
vi.stubGlobal('crypto', webcrypto);
afterEach(() => {
    for (const modal of [...Modal.opened]) modal.close();
    Notice.messages = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
});
