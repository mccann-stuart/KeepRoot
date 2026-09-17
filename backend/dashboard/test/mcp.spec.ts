import { describe, expect, it } from 'vitest';
import {
	buildClaudeCodePreset,
	buildMcpPresets,
	buildOpenAiPreset,
	getDefaultSourceKind,
	getMcpEndpoint,
	getSourceKindOptions,
	getSourceSummaryLine,
} from '../src/lib/mcp';
import type { AccountFeatures, SourceRecord } from '../src/lib/state';

describe('mcp helpers', () => {
	describe('getMcpEndpoint', () => {
		it('appends /mcp to origin without trailing slash', () => {
			expect(getMcpEndpoint('https://example.com')).toBe('https://example.com/mcp');
		});

		it('strips trailing slash before appending /mcp', () => {
			expect(getMcpEndpoint('https://example.com/')).toBe('https://example.com/mcp');
		});
	});

	describe('buildClaudeCodePreset', () => {
		it('formats claude code mcp CLI command correctly', () => {
			const endpoint = 'https://example.com/mcp';
			const result = buildClaudeCodePreset(endpoint);
			expect(result).toBe(
				'claude mcp add --transport http keeproot https://example.com/mcp --header "Authorization: Bearer <API_KEY>"'
			);
		});
	});

	describe('buildOpenAiPreset', () => {
		it('formats openai connector config as JSON string', () => {
			const endpoint = 'https://example.com/mcp';
			const result = buildOpenAiPreset(endpoint);
			const parsed = JSON.parse(result);

			expect(parsed).toEqual({
				authorization: 'Bearer <API_KEY>',
				require_approval: 'always',
				server_label: 'keeproot',
				server_url: endpoint,
				type: 'mcp',
			});
		});
	});

	describe('buildMcpPresets', () => {
		it('returns claude-code and openai preset configurations', () => {
			const presets = buildMcpPresets('https://example.com');
			expect(presets).toHaveLength(2);

			const [claudePreset, openaiPreset] = presets;
			expect(claudePreset.id).toBe('claude-code');
			expect(claudePreset.language).toBe('bash');
			expect(claudePreset.value).toContain('https://example.com/mcp');

			expect(openaiPreset.id).toBe('openai');
			expect(openaiPreset.language).toBe('json');
			expect(openaiPreset.value).toContain('https://example.com/mcp');
		});
	});

	describe('getSourceKindOptions', () => {
		it('enables all kinds when features is null', () => {
			const options = getSourceKindOptions(null);
			expect(options.length).toBeGreaterThan(0);
			for (const option of options) {
				expect(option.disabled).toBe(false);
			}
		});

		it('respects account features flags to mark disabled options', () => {
			const features: AccountFeatures = {
				browser: true,
				email: false,
				rss: true,
				x: false,
				youtube: true,
			};

			const options = getSourceKindOptions(features);
			const emailOption = options.find((o) => o.kind === 'email');
			const rssOption = options.find((o) => o.kind === 'rss');

			expect(emailOption?.disabled).toBe(true);
			expect(rssOption?.disabled).toBe(false);
		});
	});

	describe('getDefaultSourceKind', () => {
		it('returns currentKind when matching and not disabled', () => {
			const features: AccountFeatures = { rss: true, youtube: true };
			expect(getDefaultSourceKind(features, 'youtube')).toBe('youtube');
		});

		it('returns first available kind when currentKind is disabled or not matched', () => {
			const features: AccountFeatures = { email: false, rss: true, youtube: true };
			expect(getDefaultSourceKind(features, 'email')).toBe('rss');
		});

		it('falls back to rss when all options are disabled', () => {
			const features: AccountFeatures = {
				browser: false,
				email: false,
				rss: false,
				x: false,
				youtube: false,
			};
			expect(getDefaultSourceKind(features, 'email')).toBe('rss');
		});
	});

	describe('getSourceSummaryLine', () => {
		it('returns emailAlias for email source with alias', () => {
			const source: SourceRecord = {
				emailAlias: 'my-alias@keeproot.app',
				id: 's1',
				kind: 'email',
				name: 'My Inbox',
				normalizedIdentifier: 'my-alias',
				status: 'active',
			};

			expect(getSourceSummaryLine(source)).toBe('my-alias@keeproot.app');
		});

		it('returns normalizedIdentifier, pollUrl, or name for other sources', () => {
			const sourceWithNorm: SourceRecord = {
				id: 's2',
				kind: 'rss',
				name: 'Feed',
				normalizedIdentifier: 'https://example.com/feed.xml',
				pollUrl: 'https://example.com/feed.xml',
				status: 'active',
			};
			expect(getSourceSummaryLine(sourceWithNorm)).toBe('https://example.com/feed.xml');

			const sourceWithPoll: SourceRecord = {
				id: 's3',
				kind: 'rss',
				name: 'Feed Name',
				normalizedIdentifier: '',
				pollUrl: 'https://example.com/rss',
				status: 'active',
			};
			expect(getSourceSummaryLine(sourceWithPoll)).toBe('https://example.com/rss');

			const sourceWithNameOnly: SourceRecord = {
				id: 's4',
				kind: 'rss',
				name: 'Custom Feed Name',
				normalizedIdentifier: '',
				pollUrl: '',
				status: 'active',
			};
			expect(getSourceSummaryLine(sourceWithNameOnly)).toBe('Custom Feed Name');
		});
	});
});
