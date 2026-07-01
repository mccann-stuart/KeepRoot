import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ensureAccountSettings } from '../../src/storage/account';

describe('account storage', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('ensureAccountSettings', () => {
		it('should create default account settings if they do not exist', async () => {
			const mockRun = vi.fn().mockResolvedValue({});
			const mockBind = vi.fn().mockReturnValue({ run: mockRun });
			const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

			const mockEnv = {
				KEEPROOT_DB: {
					prepare: mockPrepare,
				},
				MCP_EMAIL_DOMAIN: '',
				EMAIL_SOURCE_DOMAIN: '',
				ENABLE_X_SOURCES: '0',
				X_SOURCE_BRIDGE_BASE_URL: '',
			} as any;

			const user = { userId: 'user-123', username: 'testuser' };

			await ensureAccountSettings(mockEnv, user);

			expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO account_settings'));
			expect(mockBind).toHaveBeenCalledWith(
				'user-123',
				'testuser',
				expect.stringContaining('maxItems'), // limits JSON
				expect.stringContaining('email'), // features JSON
				expect.any(String), // created_at
				expect.any(String)  // updated_at
			);
			expect(mockRun).toHaveBeenCalled();
		});

        it('should correctly determine email feature based on env', async () => {
			const mockRun = vi.fn().mockResolvedValue({});
			const mockBind = vi.fn().mockReturnValue({ run: mockRun });
			const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

			const mockEnv = {
				KEEPROOT_DB: {
					prepare: mockPrepare,
				},
				MCP_EMAIL_DOMAIN: 'example.com',
				EMAIL_SOURCE_DOMAIN: '',
				ENABLE_X_SOURCES: '0',
				X_SOURCE_BRIDGE_BASE_URL: '',
			} as any;

			const user = { userId: 'user-123', username: 'testuser' };

			await ensureAccountSettings(mockEnv, user);

            const expectedFeatures = JSON.stringify({
                email: true,
                rss: true,
                x: false,
                youtube: true
            });

			expect(mockBind).toHaveBeenCalledWith(
				'user-123',
				'testuser',
				expect.any(String), // limits JSON
				expectedFeatures, // features JSON
				expect.any(String), // created_at
				expect.any(String)  // updated_at
			);
		});

        it('should correctly determine x feature based on env', async () => {
			const mockRun = vi.fn().mockResolvedValue({});
			const mockBind = vi.fn().mockReturnValue({ run: mockRun });
			const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

			const mockEnv = {
				KEEPROOT_DB: {
					prepare: mockPrepare,
				},
				MCP_EMAIL_DOMAIN: '',
				EMAIL_SOURCE_DOMAIN: '',
				ENABLE_X_SOURCES: '1',
				X_SOURCE_BRIDGE_BASE_URL: '',
			} as any;

			const user = { userId: 'user-123', username: 'testuser' };

			await ensureAccountSettings(mockEnv, user);

            const expectedFeatures = JSON.stringify({
                email: false,
                rss: true,
                x: true,
                youtube: true
            });

			expect(mockBind).toHaveBeenCalledWith(
				'user-123',
				'testuser',
				expect.any(String), // limits JSON
				expectedFeatures, // features JSON
				expect.any(String), // created_at
				expect.any(String)  // updated_at
			);
		});
	});
});
