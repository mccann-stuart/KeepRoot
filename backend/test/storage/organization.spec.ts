import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateOrganizationSchema, SchemaCompatibilityError } from '../../src/storage/organization';

describe('organization storage', () => {
    describe('validateOrganizationSchema', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('throws SchemaCompatibilityError when table count does not match REQUIRED_TABLE_NAMES', async () => {
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
                if (query.includes('sqlite_master')) {
                    return {
                        bind: (...args: any[]) => ({
                            first: async () => ({ count: args.length - 1 })
                        })
                    } as any;
                }
                return {} as any;
            });

            await expect(validateOrganizationSchema(env as any)).rejects.toThrow(SchemaCompatibilityError);
        });

        it('throws SchemaCompatibilityError when bookmark columns are missing', async () => {
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
                if (query.includes('sqlite_master')) {
                    return {
                        bind: (...args: any[]) => ({
                            first: async () => ({ count: args.length })
                        })
                    } as any;
                }
                if (query.includes('PRAGMA table_info')) {
                    return {
                        all: async () => ({ results: [{ name: 'list_id' }] })
                    } as any;
                }
                return {} as any;
            });

            await expect(validateOrganizationSchema(env as any)).rejects.toThrow(SchemaCompatibilityError);
        });

        it('passes validation when schema is correct', async () => {
            vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
                if (query.includes('sqlite_master')) {
                    return {
                        bind: (...args: any[]) => ({
                            first: async () => ({ count: args.length })
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
                return {} as any;
            });

            await expect(validateOrganizationSchema(env as any)).resolves.toBeUndefined();
        });
    });
});
