import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createList,
    listUserLists,
    updateList,
    deleteList,
    createSmartList,
    listUserSmartLists,
    updateSmartList,
    deleteSmartList,
} from '../../src/storage/lists';

describe('lists storage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('createList', () => {
        it('creates a new list and returns its id and name', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await createList(env as any, 'user-1', { name: 'My List', sortOrder: 5 });

            expect(prepareSpy).toHaveBeenCalledWith('INSERT INTO lists (id, user_id, name, created_at, sort_order) VALUES (?, ?, ?, ?, ?)');
            expect(bindSpy).toHaveBeenCalledWith(expect.any(String), 'user-1', 'My List', expect.any(String), 5);
            expect(result).toEqual({ id: expect.any(String), name: 'My List' });
        });

        it('defaults sortOrder to 0 if not provided', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            await createList(env as any, 'user-1', { name: 'Default Sort List' });

            expect(bindSpy).toHaveBeenCalledWith(expect.any(String), 'user-1', 'Default Sort List', expect.any(String), 0);
        });
    });

    describe('listUserLists', () => {
        it('returns lists ordered by sort_order and created_at', async () => {
            const allSpy = vi.fn().mockResolvedValue({
                results: [
                    { id: 'list-1', name: 'List 1', sort_order: 1 },
                    { id: 'list-2', name: 'List 2', sort_order: 2 },
                ]
            });
            const bindSpy = vi.fn().mockReturnValue({ all: allSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await listUserLists(env as any, 'user-1');

            expect(prepareSpy).toHaveBeenCalledWith('SELECT id, name, sort_order FROM lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC');
            expect(bindSpy).toHaveBeenCalledWith('user-1');
            expect(result).toEqual([
                { id: 'list-1', name: 'List 1', sortOrder: 1 },
                { id: 'list-2', name: 'List 2', sortOrder: 2 },
            ]);
        });
    });

    describe('updateList', () => {
        it('returns true immediately if payload is empty', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');
            const result = await updateList(env as any, 'user-1', 'list-1', {});

            expect(prepareSpy).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('updates list properties', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateList(env as any, 'user-1', 'list-1', { name: 'New Name', sortOrder: 10 });

            expect(prepareSpy).toHaveBeenCalled(); // String matches update query
            expect(bindSpy).toHaveBeenCalledWith(
                1, 'New Name',
                1, 10,
                'list-1', 'user-1'
            );
            expect(result).toBe(true);
        });

        it('returns false if no changes were made', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateList(env as any, 'user-1', 'list-missing', { name: 'Failed Update' });

            expect(result).toBe(false);
        });
    });

    describe('deleteList', () => {
        it('deletes a list', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await deleteList(env as any, 'user-1', 'list-1');

            expect(prepareSpy).toHaveBeenCalledWith('DELETE FROM lists WHERE id = ? AND user_id = ?');
            expect(bindSpy).toHaveBeenCalledWith('list-1', 'user-1');
            expect(result).toBe(true);
        });

        it('returns false if list was not found', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await deleteList(env as any, 'user-1', 'list-missing');

            expect(result).toBe(false);
        });
    });

    describe('createSmartList', () => {
        it('creates a new smart list', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await createSmartList(env as any, 'user-1', {
                name: 'My Smart List',
                icon: 'star',
                rules: 'test rules',
                sortOrder: 3
            });

            expect(prepareSpy).toHaveBeenCalledWith('INSERT INTO smart_lists (id, user_id, name, icon, rules, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
            expect(bindSpy).toHaveBeenCalledWith(expect.any(String), 'user-1', 'My Smart List', 'star', 'test rules', expect.any(String), 3);
            expect(result).toEqual({
                id: expect.any(String),
                name: 'My Smart List',
                icon: 'star',
                rules: 'test rules',
                sortOrder: 3
            });
        });

        it('defaults sortOrder and icon if not provided', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            await createSmartList(env as any, 'user-1', {
                name: 'Default Smart List',
                rules: 'default rules'
            });

            expect(bindSpy).toHaveBeenCalledWith(expect.any(String), 'user-1', 'Default Smart List', null, 'default rules', expect.any(String), 0);
        });
    });

    describe('listUserSmartLists', () => {
        it('returns smart lists ordered by sort_order and created_at', async () => {
            const allSpy = vi.fn().mockResolvedValue({
                results: [
                    { id: 'smart-1', name: 'Smart 1', icon: 'star', rules: 'r1', sort_order: 1 },
                    { id: 'smart-2', name: 'Smart 2', icon: null, rules: 'r2', sort_order: 2 },
                ]
            });
            const bindSpy = vi.fn().mockReturnValue({ all: allSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await listUserSmartLists(env as any, 'user-1');

            expect(prepareSpy).toHaveBeenCalledWith('SELECT id, name, icon, rules, sort_order FROM smart_lists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC');
            expect(bindSpy).toHaveBeenCalledWith('user-1');
            expect(result).toEqual([
                { id: 'smart-1', name: 'Smart 1', icon: 'star', rules: 'r1', sortOrder: 1 },
                { id: 'smart-2', name: 'Smart 2', icon: null, rules: 'r2', sortOrder: 2 },
            ]);
        });
    });

    describe('updateSmartList', () => {
        it('checks for existence if payload is empty', async () => {
            const firstSpy = vi.fn().mockResolvedValue({ id: 'smart-1' });
            const bindSpy = vi.fn().mockReturnValue({ first: firstSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateSmartList(env as any, 'user-1', 'smart-1', {});

            expect(prepareSpy).toHaveBeenCalledWith('SELECT id FROM smart_lists WHERE id = ? AND user_id = ? LIMIT 1');
            expect(bindSpy).toHaveBeenCalledWith('smart-1', 'user-1');
            expect(result).toBe(true);
        });

        it('returns false if payload is empty and list does not exist', async () => {
            const firstSpy = vi.fn().mockResolvedValue(null);
            const bindSpy = vi.fn().mockReturnValue({ first: firstSpy });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateSmartList(env as any, 'user-1', 'smart-missing', {});

            expect(result).toBe(false);
        });

        it('updates smart list properties', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateSmartList(env as any, 'user-1', 'smart-1', {
                name: 'New Name',
                icon: 'heart',
                rules: 'new rules',
                sortOrder: 10
            });

            expect(prepareSpy).toHaveBeenCalled(); // String matches update query
            expect(bindSpy).toHaveBeenCalledWith(
                1, 'New Name',
                1, 'heart',
                1, 'new rules',
                1, 10,
                'smart-1', 'user-1'
            );
            expect(result).toBe(true);
        });

        it('returns false if no changes were made', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await updateSmartList(env as any, 'user-1', 'smart-missing', { name: 'Failed Update' });

            expect(result).toBe(false);
        });
    });

    describe('deleteSmartList', () => {
        it('deletes a smart list', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await deleteSmartList(env as any, 'user-1', 'smart-1');

            expect(prepareSpy).toHaveBeenCalledWith('DELETE FROM smart_lists WHERE id = ? AND user_id = ?');
            expect(bindSpy).toHaveBeenCalledWith('smart-1', 'user-1');
            expect(result).toBe(true);
        });

        it('returns false if smart list was not found', async () => {
            const runSpy = vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } });
            const bindSpy = vi.fn().mockReturnValue({ run: runSpy });
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockReturnValue({ bind: bindSpy } as any);

            const result = await deleteSmartList(env as any, 'user-1', 'smart-missing');

            expect(result).toBe(false);
        });
    });
});
