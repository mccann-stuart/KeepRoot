import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSource, listActivePollableSources, listDuePollableSources } from '../../src/storage/sources';

describe('sources storage', () => {
    describe('addSource', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<rss><channel></channel></rss>', {
				headers: { 'Content-Type': 'application/rss+xml' },
			}));
        });

        it('reactivates duplicate sources without replacing their stored row', async () => {
            const userId = 'test-user-id';
            const kind = 'rss';
            const identifier = 'https://example.com/feed';

            const existingId = crypto.randomUUID();

            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    bind: (...args: any[]) => ({
                        first: async () => {
                            if (query.includes('SELECT id, email_alias')) {
                                return { id: existingId, email_alias: 'save+123@keeproot.com' };
                            }
                            return null;
                        },
                        run: async () => ({ success: true }),
                    }),
                } as any;
            });

            const batchSpy = vi.spyOn(env.KEEPROOT_DB, 'batch').mockImplementation(async (stmts) => {
                return [
                    { results: [{ id: existingId, name: 'My Updated Feed Name', kind, normalized_identifier: identifier, poll_url: identifier, status: 'active' }] },
                    { results: [] }
                ] as any;
            });

            // Mock env.MCP_EMAIL_DOMAIN so it doesn't fail on missing env
            const mockEnv = {
                ...env,
                MCP_EMAIL_DOMAIN: 'keeproot.com',
            } as any;

            // Notice the arguments: mockEnv, { config, identifier, kind, name, userId }
            const duplicateSource = await addSource(mockEnv, {
                userId,
                kind,
                identifier,
                name: 'My Updated Feed Name',
            });

            // The ID should remain the same
            expect(duplicateSource.id).toBe(existingId);

            // The getSourceById batch call returns an array of objects for the batch, one is the result for source. It should have the correct name.
            expect(duplicateSource.name).toBe('My Updated Feed Name');

            expect(prepareSpy).toHaveBeenCalledTimes(4);
            expect(prepareSpy.mock.calls[0][0]).toContain('SELECT id, email_alias');
            expect(prepareSpy.mock.calls[1][0]).toContain('INSERT INTO sources');
            expect(prepareSpy.mock.calls[1][0]).toContain('ON CONFLICT(id) DO UPDATE');
            expect(prepareSpy.mock.calls[1][0]).toContain("status = 'active'");
            expect(prepareSpy.mock.calls[1][0]).not.toContain('INSERT OR REPLACE');

            expect(batchSpy).toHaveBeenCalledTimes(1);
        });

		it('rejects a non-feed response before writing a source row', async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(new Response(
				'<!doctype html><html><body>Ordinary website</body></html>',
				{ headers: { 'Content-Type': 'text/html' } },
			));
			const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');

			await expect(addSource(env as any, {
				identifier: 'https://example.com/',
				kind: 'rss',
				userId: 'test-user-id',
			})).rejects.toMatchObject({
				message: 'Source URL did not return an RSS or Atom feed',
				name: 'ValidationError',
			});

			expect(prepareSpy).not.toHaveBeenCalled();
		});

		it('stores a configured Browser Run source daily without RSS validation', async () => {
			const bindCalls: unknown[][] = [];
			const prepare = vi.fn((query: string) => ({
				bind: (...args: unknown[]) => {
					bindCalls.push(args);
					return {
						first: async () => null,
						run: async () => ({ meta: { changes: 1 } }),
					};
				},
			}));
			const sourceRow = {
				config_json: '{}', created_at: '2026-08-13T12:00:00.000Z', email_alias: null,
				id: 'browser-source', kind: 'browser', last_error: null, last_polled_at: null,
				last_success_at: null, name: 'Example Blog', next_poll_at: null,
				normalized_identifier: 'https://example.com/blog', poll_interval_minutes: 1440,
				poll_url: 'https://example.com/blog', status: 'active', updated_at: '2026-08-13T12:00:00.000Z',
			};
			const storageEnv = {
				BROWSER_RUN_ACCOUNT_ID: 'account-id',
				BROWSER_RUN_API_TOKEN: 'api-token',
				KEEPROOT_DB: {
					batch: vi.fn().mockResolvedValue([{ results: [sourceRow] }, { results: [] }]),
					prepare,
				},
				SOURCE_QUEUE: { send: vi.fn() },
			};

			const source = await addSource(storageEnv as any, {
				identifier: 'https://example.com/blog',
				kind: 'browser',
				name: 'Example Blog',
				userId: 'test-user-id',
			});

			expect(globalThis.fetch).not.toHaveBeenCalled();
			expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sources'));
			expect(bindCalls.some((bindings) => bindings.includes(1440))).toBe(true);
			expect(source).toMatchObject({ kind: 'browser', pollIntervalMinutes: 1440 });
		});

		it('rejects Agentic scraping when operator credentials are incomplete', async () => {
			const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare');

			await expect(addSource({
				...env,
				BROWSER_RUN_ACCOUNT_ID: undefined,
				BROWSER_RUN_API_TOKEN: undefined,
				SOURCE_QUEUE: { send: vi.fn() },
			} as any, {
				identifier: 'https://example.com/blog',
				kind: 'browser',
				userId: 'test-user-id',
			})).rejects.toMatchObject({
				message: 'Agentic scraping requires Browser Run account credentials and SOURCE_QUEUE',
				name: 'ValidationError',
			});

			expect(prepareSpy).not.toHaveBeenCalled();
		});
    });

    describe('listActivePollableSources', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('returns sources that are active and have a poll_url', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    all: async () => ({
                        results: [
                            {
                                config_json: '{"foo":"bar"}',
                                id: '1',
                                kind: 'rss',
								last_polled_at: '2023-01-01',
								name: 'my source',
								next_poll_at: '2023-01-01T01:00:00.000Z',
								poll_interval_minutes: 60,
                                poll_url: 'http://foo',
                                user_id: 'u1'
                            }
                        ]
                    })
                } as any;
            });

            const sources = await listActivePollableSources(env as any);

            expect(prepareSpy).toHaveBeenCalledTimes(1);
            expect(prepareSpy.mock.calls[0][0]).toContain('SELECT id, user_id, kind, name, poll_url, config_json, last_polled_at');
            expect(prepareSpy.mock.calls[0][0]).toContain("WHERE status = 'active' AND poll_url IS NOT NULL");

            expect(sources.length).toBe(1);
            expect(sources[0]).toEqual({
                config: { foo: 'bar' },
				httpEtag: null,
				httpLastModified: null,
                id: '1',
                kind: 'rss',
                lastPolledAt: '2023-01-01',
				name: 'my source',
				nextPollAt: '2023-01-01T01:00:00.000Z',
				pollIntervalMinutes: 60,
                pollUrl: 'http://foo',
				userId: 'u1',
				validatorUrl: null,
            });
        });

        it('returns empty list when no matching sources exist', async () => {
            const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation((query) => {
                return {
                    all: async () => ({
                        results: []
                    })
                } as any;
            });

            const sources = await listActivePollableSources(env as any);

            expect(prepareSpy).toHaveBeenCalledTimes(1);
            expect(sources.length).toBe(0);
        });
    });

	describe('listDuePollableSources', () => {
		beforeEach(() => {
			vi.restoreAllMocks();
		});

		it('returns only active pollable sources due by the supplied time', async () => {
			const dueAt = '2026-08-06T12:00:00.000Z';
			const prepareSpy = vi.spyOn(env.KEEPROOT_DB, 'prepare').mockImplementation(() => ({
				bind: (...bindings: unknown[]) => ({
					all: async () => ({ results: [{
						config_json: '{}',
						http_etag: '"feed-v2"',
						http_last_modified: 'Thu, 06 Aug 2026 10:00:00 GMT',
						id: 'source-due',
						kind: 'rss',
						last_polled_at: '2026-08-06T10:00:00.000Z',
						name: 'Due feed',
						next_poll_at: dueAt,
						poll_interval_minutes: 120,
						poll_url: 'https://example.com/feed.xml',
						user_id: 'user-1',
						validator_url: 'https://example.com/feed.xml',
					}] }),
					bindings,
				}),
			})) as any;

			const sources = await listDuePollableSources(env as any, dueAt);

			expect(prepareSpy.mock.calls[0][0]).toContain("status = 'active' AND poll_url IS NOT NULL");
			expect(prepareSpy.mock.calls[0][0]).toContain('next_poll_at IS NULL OR next_poll_at <= ?');
			expect(prepareSpy.mock.calls[0][0]).toContain('active_run_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?');
			expect(sources).toEqual([{
				config: {},
				httpEtag: '"feed-v2"',
				httpLastModified: 'Thu, 06 Aug 2026 10:00:00 GMT',
				id: 'source-due',
				kind: 'rss',
				lastPolledAt: '2026-08-06T10:00:00.000Z',
				name: 'Due feed',
				nextPollAt: dueAt,
				pollIntervalMinutes: 120,
				pollUrl: 'https://example.com/feed.xml',
				userId: 'user-1',
				validatorUrl: 'https://example.com/feed.xml',
			}]);
		});
	});
});
