import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestEmailMessage } from '../../src/ingest/email';
import * as sources from '../../src/storage/sources';
import * as items from '../../src/storage/items';
import PostalMime from 'postal-mime';

vi.mock('../../src/storage/sources', () => ({
	getSourceByEmailAlias: vi.fn(),
}));

vi.mock('../../src/storage/items', () => ({
	saveItemContent: vi.fn(),
}));

vi.mock('postal-mime', () => ({
	default: {
		parse: vi.fn(),
	},
}));

describe('ingestEmailMessage', () => {
	let env: any;
	let message: any;
	let mockPrepare: any;
	let mockBind: any;
	let mockFirst: any;
	let consoleWarnSpy: any;

	beforeEach(() => {
		vi.resetAllMocks();

		mockFirst = vi.fn().mockResolvedValue(null);
		mockBind = vi.fn().mockReturnValue({ first: mockFirst });
		mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

		env = {
			KEEPROOT_DB: {
				prepare: mockPrepare,
			},
		};

		message = {
			to: 'test@example.com',
			raw: 'mock-raw-data',
			setReject: vi.fn(),
		};

		consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('rejects the message if source is not found', async () => {
		vi.mocked(sources.getSourceByEmailAlias).mockResolvedValue(null);

		await ingestEmailMessage(env, message);

		expect(sources.getSourceByEmailAlias).toHaveBeenCalledWith(env, 'test@example.com');
		expect(message.setReject).toHaveBeenCalledWith('Unknown KeepRoot email source');
		expect(PostalMime.parse).not.toHaveBeenCalled();
	});

	it('logs warning and returns if no URL is found in the parsed email', async () => {
		vi.mocked(sources.getSourceByEmailAlias).mockResolvedValue({ id: 'source-1', userId: 'user-1' } as any);
		vi.mocked(PostalMime.parse).mockResolvedValue({
			text: 'Hello, no links here!',
			html: '<html><body>Hello, no links here!</body></html>',
			subject: 'Test Subject',
		} as any);

		await ingestEmailMessage(env, message);

		expect(PostalMime.parse).toHaveBeenCalledWith('mock-raw-data');
		expect(consoleWarnSpy).toHaveBeenCalledWith('Email source received a message without a URL');
		expect(items.saveItemContent).not.toHaveBeenCalled();
	});

	it('extracts URL from text, gets username, and saves item', async () => {
		vi.mocked(sources.getSourceByEmailAlias).mockResolvedValue({ id: 'source-1', userId: 'user-1' } as any);
		vi.mocked(PostalMime.parse).mockResolvedValue({
			text: 'Check this out: https://example.com/path',
			subject: 'Cool Link',
		} as any);

		mockFirst.mockResolvedValue({ username: 'testuser' });

		await ingestEmailMessage(env, message);

		expect(mockPrepare).toHaveBeenCalledWith('SELECT username FROM users WHERE id = ? LIMIT 1');
		expect(mockBind).toHaveBeenCalledWith('user-1');

		expect(items.saveItemContent).toHaveBeenCalledWith(
			env,
			{ userId: 'user-1', username: 'testuser' },
			{
				htmlData: undefined,
				notes: 'Saved from email: Cool Link',
				sourceId: 'source-1',
				status: 'saved',
				textContent: 'Check this out: https://example.com/path',
				title: 'Cool Link',
				url: 'https://example.com/path',
			},
			'email_ingest'
		);
	});

	it('extracts URL from html, uses userId if username missing, and saves item with fallback title', async () => {
		vi.mocked(sources.getSourceByEmailAlias).mockResolvedValue({ id: 'source-1', userId: 'user-2' } as any);
		vi.mocked(PostalMime.parse).mockResolvedValue({
			text: null,
			html: '<a href="http://example.org">Link</a>',
			subject: null,
		} as any);

		mockFirst.mockResolvedValue(null);

		await ingestEmailMessage(env, message);

		expect(items.saveItemContent).toHaveBeenCalledWith(
			env,
			{ userId: 'user-2', username: 'user-2' },
			{
				htmlData: '<a href="http://example.org">Link</a>',
				notes: 'Saved from email',
				sourceId: 'source-1',
				status: 'saved',
				textContent: 'http://example.org',
				title: 'http://example.org',
				url: 'http://example.org',
			},
			'email_ingest'
		);
	});
});
