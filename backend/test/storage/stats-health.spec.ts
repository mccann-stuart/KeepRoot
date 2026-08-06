import { describe, expect, it } from 'vitest';
import { classifySourceHealth } from '../../src/storage/stats';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');

function health(overrides: Partial<Parameters<typeof classifySourceHealth>[0]> = {}) {
	return classifySourceHealth({
		consecutiveFailures: 0,
		consecutiveSaturated: 0,
		dailyRefreshes: 0,
		latestDiscovered: 19,
		latestSaturated: false,
		processingErrors: 0,
		lastError: null,
		lastSuccessAt: '2026-08-06T09:00:01.000Z',
		now: NOW,
		...overrides,
	});
}

describe('source ingestion health thresholds', () => {
	it('is green only for a recent, low-volume, error-free source', () => {
		expect(health()).toBe('green');
	});

	it.each([
		{ lastSuccessAt: '2026-08-06T08:00:00.000Z' },
		{ latestDiscovered: 20 },
		{ latestDiscovered: 24 },
		{ latestSaturated: true },
		{ dailyRefreshes: 2_001 },
		{ lastSuccessAt: null },
	])('is amber for an attention threshold: %o', (override) => {
		expect(health(override)).toBe('amber');
	});

	it.each([
		{ lastSuccessAt: '2026-08-05T23:59:59.000Z' },
		{ consecutiveFailures: 2 },
		{ consecutiveSaturated: 2 },
		{ processingErrors: 1 },
	])('is red for a failure threshold: %o', (override) => {
		expect(health(override)).toBe('red');
	});
});
