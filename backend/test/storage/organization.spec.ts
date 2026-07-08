import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOrganizationSchemaReady, SchemaCompatibilityError } from '../../src/storage/organization';

describe('assertOrganizationSchemaReady', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should pass schema validation when all tables and columns are present', async () => {
        const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
            if (query.includes('sqlite_master')) {
                return {
                    bind: () => ({
                        first: async () => ({ count: 10 }), // REQUIRED_TABLE_NAMES.length is 10
                    })
                } as any;
            }
            if (query.includes('PRAGMA table_info')) {
                return {
                    all: async () => ({
                        results: [
                            { name: 'list_id' },
                            { name: 'pinned' },
                            { name: 'sort_order' },
                            { name: 'is_read' },
                            { name: 'notes' },
                            { name: 'source_id' },
                            { name: 'processing_state' },
                            { name: 'search_updated_at' },
                            { name: 'embedding_updated_at' },
                        ]
                    })
                } as any;
            }
            return { all: async () => ({ results: [] }) } as any;
        });

        // We need a fresh env to avoid WeakMap caching between tests
        const mockEnv = { ...env };

        await expect(assertOrganizationSchemaReady(mockEnv as any)).resolves.toBeUndefined();

        expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('sqlite_master'));
        expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining('PRAGMA table_info'));
    });

    it('should throw SchemaCompatibilityError when a required table is missing', async () => {
        vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
            if (query.includes('sqlite_master')) {
                return {
                    bind: () => ({
                        first: async () => ({ count: 9 }), // One less than REQUIRED_TABLE_NAMES.length (10)
                    })
                } as any;
            }
            return { all: async () => ({ results: [] }) } as any;
        });

        const mockEnv = { ...env };

        await expect(assertOrganizationSchemaReady(mockEnv as any)).rejects.toThrowError(SchemaCompatibilityError);
    });

    it('should throw SchemaCompatibilityError when a required column is missing', async () => {
        vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
            if (query.includes('sqlite_master')) {
                return {
                    bind: () => ({
                        first: async () => ({ count: 10 }), // Tables are fine
                    })
                } as any;
            }
            if (query.includes('PRAGMA table_info')) {
                return {
                    all: async () => ({
                        results: [
                            { name: 'list_id' },
                            // 'pinned' is missing
                            { name: 'sort_order' },
                            { name: 'is_read' },
                            { name: 'notes' },
                            { name: 'source_id' },
                            { name: 'processing_state' },
                            { name: 'search_updated_at' },
                            { name: 'embedding_updated_at' },
                        ]
                    })
                } as any;
            }
            return { all: async () => ({ results: [] }) } as any;
        });

        const mockEnv = { ...env };

        const promise = assertOrganizationSchemaReady(mockEnv as any);
        await expect(promise).rejects.toThrowError(SchemaCompatibilityError);
        await expect(promise).rejects.toThrow(/Missing bookmarks columns: pinned/);
    });

    it('should cache successful validation results per env', async () => {
        const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
            if (query.includes('sqlite_master')) {
                return {
                    bind: () => ({
                        first: async () => ({ count: 10 }),
                    })
                } as any;
            }
            if (query.includes('PRAGMA table_info')) {
                return {
                    all: async () => ({
                        results: [
                            { name: 'list_id' },
                            { name: 'pinned' },
                            { name: 'sort_order' },
                            { name: 'is_read' },
                            { name: 'notes' },
                            { name: 'source_id' },
                            { name: 'processing_state' },
                            { name: 'search_updated_at' },
                            { name: 'embedding_updated_at' },
                        ]
                    })
                } as any;
            }
            return { all: async () => ({ results: [] }) } as any;
        });

        const mockEnv = { ...env };

        await assertOrganizationSchemaReady(mockEnv as any);
        await assertOrganizationSchemaReady(mockEnv as any);
        await assertOrganizationSchemaReady(mockEnv as any);

        // Should only query database once
        expect(prepareSpy).toHaveBeenCalledTimes(2); // 1 for sqlite_master, 1 for table_info
    });

    it('should clear cache on failed validation', async () => {
        // First validation fails
        let attempt = 0;
        const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
            attempt++;
            if (query.includes('sqlite_master')) {
                return {
                    bind: () => ({
                        first: async () => ({ count: attempt === 1 ? 9 : 10 }),
                    })
                } as any;
            }
            if (query.includes('PRAGMA table_info')) {
                return {
                    all: async () => ({
                        results: [
                            { name: 'list_id' },
                            { name: 'pinned' },
                            { name: 'sort_order' },
                            { name: 'is_read' },
                            { name: 'notes' },
                            { name: 'source_id' },
                            { name: 'processing_state' },
                            { name: 'search_updated_at' },
                            { name: 'embedding_updated_at' },
                        ]
                    })
                } as any;
            }
            return { all: async () => ({ results: [] }) } as any;
        });

        const mockEnv = { ...env };

        // Fails
        await expect(assertOrganizationSchemaReady(mockEnv as any)).rejects.toThrowError(SchemaCompatibilityError);

        // Try again, it should re-evaluate because cache was cleared
        await expect(assertOrganizationSchemaReady(mockEnv as any)).resolves.toBeUndefined();

        // Ensure database was queried twice (1st failed, 2nd success)
        // attempt is actually the number of times `prepare` was called in total.
        // First call: sqlite_master -> fail
        // Second call: sqlite_master -> success
        // Third call: table_info -> success
        expect(prepareSpy).toHaveBeenCalledTimes(3);
    });
});
