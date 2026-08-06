import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOrganizationSchemaReady, validateOrganizationSchema, SchemaCompatibilityError } from '../../src/storage/organization';

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
                if (query.includes('pragma_table_info')) {
                    return {
                        bind: (...args: any[]) => ({
                            all: async () => ({ results: [{ name: 'list_id' }] })
                        })
                    } as any;
                }
                return {} as any;
            });

            await expect(validateOrganizationSchema(env as any)).rejects.toThrow(SchemaCompatibilityError);
        });

		it('rejects the queue schema when adaptive scheduling columns are missing', async () => {
			vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
				if (query.includes('sqlite_master')) {
					return {
						bind: (...args: any[]) => ({ first: async () => ({ count: args.length }) }),
					} as any;
				}
				if (query.includes('pragma_table_info')) {
					return {
						bind: () => ({
							all: async () => ({ results: [
								{ name: 'list_id' }, { name: 'pinned' }, { name: 'sort_order' },
								{ name: 'is_read' }, { name: 'notes' }, { name: 'source_id' },
								{ name: 'source_entry_id' }, { name: 'source_entry_fingerprint' },
								{ name: 'processing_state' }, { name: 'search_updated_at' },
								{ name: 'embedding_updated_at' }, { name: 'validator_url' },
								{ name: 'http_etag' }, { name: 'http_last_modified' },
								{ name: 'active_run_id' }, { name: 'lease_expires_at' },
								{ name: 'dispatch_key' }, { name: 'attempt_count' },
								{ name: 'processed_count' }, { name: 'created_count' },
								{ name: 'refreshed_count' }, { name: 'unchanged_count' },
								{ name: 'not_modified' }, { name: 'saturated' },
								{ name: 'duration_ms' }, { name: 'queued_at' },
							] }),
						}),
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
                if (query.includes('pragma_table_info')) {
                    return {
                        bind: (...args: any[]) => ({
                            all: async () => ({ results: [
                                { name: 'list_id' },
                                { name: 'pinned' },
                                { name: 'sort_order' },
                                { name: 'is_read' },
                                { name: 'notes' },
                                { name: 'source_id' },
                                { name: 'source_entry_id' },
								{ name: 'source_entry_fingerprint' },
								{ name: 'published_at' },
                                { name: 'processing_state' },
                                { name: 'search_updated_at' },
                                { name: 'embedding_updated_at' },
								{ name: 'validator_url' }, { name: 'http_etag' }, { name: 'http_last_modified' },
								{ name: 'active_run_id' }, { name: 'lease_expires_at' }, { name: 'next_poll_at' },
								{ name: 'poll_interval_minutes' }, { name: 'dispatch_key' },
								{ name: 'attempt_count' }, { name: 'processed_count' }, { name: 'created_count' },
								{ name: 'refreshed_count' }, { name: 'unchanged_count' }, { name: 'not_modified' },
								{ name: 'saturated' }, { name: 'duration_ms' }, { name: 'queued_at' },
                            ] })
                        })
                    } as any;
                }
                return {} as any;
            });

            await expect(validateOrganizationSchema(env as any)).resolves.toBeUndefined();
        });
    });

    describe('assertOrganizationSchemaReady', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('caches successful validation for each environment', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
                if (query.includes('sqlite_master')) {
                    return {
                        bind: (...args: any[]) => ({
                            first: async () => ({ count: args.length })
                        })
                    } as any;
                }
                if (query.includes('pragma_table_info')) {
                    return {
                        bind: (...args: any[]) => ({
                            all: async () => ({ results: [
                                { name: 'list_id' },
                                { name: 'pinned' },
                                { name: 'sort_order' },
                                { name: 'is_read' },
                                { name: 'notes' },
                                { name: 'source_id' },
                                { name: 'source_entry_id' },
								{ name: 'source_entry_fingerprint' },
								{ name: 'published_at' },
                                { name: 'processing_state' },
                                { name: 'search_updated_at' },
                                { name: 'embedding_updated_at' },
								{ name: 'validator_url' }, { name: 'http_etag' }, { name: 'http_last_modified' },
								{ name: 'active_run_id' }, { name: 'lease_expires_at' }, { name: 'next_poll_at' },
								{ name: 'poll_interval_minutes' }, { name: 'dispatch_key' },
								{ name: 'attempt_count' }, { name: 'processed_count' }, { name: 'created_count' },
								{ name: 'refreshed_count' }, { name: 'unchanged_count' }, { name: 'not_modified' },
								{ name: 'saturated' }, { name: 'duration_ms' }, { name: 'queued_at' },
                            ] })
                        })
                    } as any;
                }
                return {} as any;
            });
            const mockEnv = { ...env };

            await assertOrganizationSchemaReady(mockEnv as any);
            await assertOrganizationSchemaReady(mockEnv as any);

            expect(prepareSpy).toHaveBeenCalledTimes(4);
        });

        it('clears a failed validation from the cache', async () => {
            let tableQueryCount = 0;
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query: string) => {
                if (query.includes('sqlite_master')) {
                    return {
                        bind: (...args: any[]) => ({
                            first: async () => ({ count: ++tableQueryCount === 1 ? args.length - 1 : args.length })
                        })
                    } as any;
                }
                if (query.includes('pragma_table_info')) {
                    return {
                        bind: (...args: any[]) => ({
                            all: async () => ({ results: [
                                { name: 'list_id' },
                                { name: 'pinned' },
                                { name: 'sort_order' },
                                { name: 'is_read' },
                                { name: 'notes' },
                                { name: 'source_id' },
                                { name: 'source_entry_id' },
								{ name: 'source_entry_fingerprint' },
								{ name: 'published_at' },
                                { name: 'processing_state' },
                                { name: 'search_updated_at' },
                                { name: 'embedding_updated_at' },
								{ name: 'validator_url' }, { name: 'http_etag' }, { name: 'http_last_modified' },
								{ name: 'active_run_id' }, { name: 'lease_expires_at' }, { name: 'next_poll_at' },
								{ name: 'poll_interval_minutes' }, { name: 'dispatch_key' },
								{ name: 'attempt_count' }, { name: 'processed_count' }, { name: 'created_count' },
								{ name: 'refreshed_count' }, { name: 'unchanged_count' }, { name: 'not_modified' },
								{ name: 'saturated' }, { name: 'duration_ms' }, { name: 'queued_at' },
                            ] })
                        })
                    } as any;
                }
                return {} as any;
            });
            const mockEnv = { ...env };

            await expect(assertOrganizationSchemaReady(mockEnv as any)).rejects.toThrow(SchemaCompatibilityError);
            await expect(assertOrganizationSchemaReady(mockEnv as any)).resolves.toBeUndefined();

            expect(prepareSpy).toHaveBeenCalledTimes(5);
        });
    });
});
