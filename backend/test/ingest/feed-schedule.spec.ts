import { describe, expect, it } from 'vitest';
import {
	calculateAdaptivePollIntervalMinutes,
	calculateNextPollAt,
	clampPollIntervalMinutes,
	normalizePublishedAt,
} from '../../src/ingest/feed-schedule';

describe('adaptive feed scheduling', () => {
	it('uses the default interval without enough valid publication history', () => {
		expect(calculateAdaptivePollIntervalMinutes([])).toBe(60);
		expect(calculateAdaptivePollIntervalMinutes(['invalid', 'also invalid'])).toBe(60);
		expect(calculateAdaptivePollIntervalMinutes([
			'2026-08-06T12:00:00.000Z',
			'2026-08-06T12:00:00.000Z',
		])).toBe(60);
	});

	it('uses the minimum interval for feeds publishing more than hourly', () => {
		expect(calculateAdaptivePollIntervalMinutes([
			'2026-08-06T12:00:00.000Z',
			'2026-08-06T11:30:00.000Z',
			'2026-08-06T11:00:00.000Z',
		])).toBe(10);
	});

	it('checks ordinary feeds at one third of their average publication gap', () => {
		expect(calculateAdaptivePollIntervalMinutes([
			'2026-08-06T00:00:00.000Z',
			'2026-08-06T12:00:00.000Z',
			'2026-08-06T06:00:00.000Z',
		])).toBe(120);
	});

	it('uses the maximum interval for feeds publishing less than once per 100 hours', () => {
		expect(calculateAdaptivePollIntervalMinutes([
			'2026-08-06T12:00:00.000Z',
			'2026-08-01T12:00:00.000Z',
		])).toBe(360);
	});

	it('uses only the 50 newest valid timestamps', () => {
		const newestHourlyValues = Array.from({ length: 50 }, (_, index) =>
			new Date(Date.parse('2026-08-06T12:00:00.000Z') - index * 60 * 60 * 1_000).toISOString(),
		);
		expect(calculateAdaptivePollIntervalMinutes([
			'2025-01-01T00:00:00.000Z',
			...newestHourlyValues,
		])).toBe(20);
	});

	it('normalises publisher dates without throwing on invalid input', () => {
		expect(normalizePublishedAt('Thu, 06 Aug 2026 12:00:00 GMT')).toBe('2026-08-06T12:00:00.000Z');
		expect(normalizePublishedAt('not-a-date')).toBeUndefined();
		expect(normalizePublishedAt(undefined)).toBeUndefined();
	});

	it('clamps stored intervals and calculates the next due time', () => {
		expect(clampPollIntervalMinutes(1)).toBe(10);
		expect(clampPollIntervalMinutes(121.6)).toBe(122);
		expect(clampPollIntervalMinutes(999)).toBe(360);
		expect(clampPollIntervalMinutes(Number.NaN)).toBe(60);
		expect(calculateNextPollAt(new Date('2026-08-06T12:00:00.000Z'), 120)).toBe('2026-08-06T14:00:00.000Z');
	});
});
