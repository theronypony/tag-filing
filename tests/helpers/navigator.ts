import type { TFile, TFolder } from 'obsidian';
import { vi } from 'vitest';

/** NN 3.4.3 marks moves for its rename listener and releases that context in finally. */
export function navigatorMoveQueue() {
    let activeMoves = 0;
    return {
        isChangingFilePaths: () => activeMoves > 0,
        executeMoveFiles: vi.fn(async (_files: TFile[], _folder: TFolder, performMove: () => Promise<unknown>) => {
            activeMoves++;
            try { return { success: true, data: await performMove() }; }
            catch (error) { return { success: false, error }; }
            finally { activeMoves--; }
        })
    };
}
