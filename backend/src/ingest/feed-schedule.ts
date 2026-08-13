export const MIN_POLL_INTERVAL_MINUTES = 10;
export const DEFAULT_POLL_INTERVAL_MINUTES = 60;
export const MAX_FEED_POLL_INTERVAL_MINUTES = 360;
export const BROWSER_POLL_INTERVAL_MINUTES = 24 * 60;

const MAX_PUBLICATION_SAMPLES = 50;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const MILLISECONDS_PER_MINUTE = 60 * 1_000;

export function clampPollIntervalMinutes(
	value: number | null | undefined,
	maximum = MAX_FEED_POLL_INTERVAL_MINUTES,
): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_POLL_INTERVAL_MINUTES;
	}
	return Math.min(
		maximum,
		Math.max(MIN_POLL_INTERVAL_MINUTES, Math.round(value as number)),
	);
}

export function clampSourcePollIntervalMinutes(
	kind: string,
	value: number | null | undefined,
): number {
	return clampPollIntervalMinutes(
		value,
		kind === 'browser' ? BROWSER_POLL_INTERVAL_MINUTES : MAX_FEED_POLL_INTERVAL_MINUTES,
	);
}

export function normalizePublishedAt(value: string | null | undefined): string | undefined {
	if (!value?.trim()) {
		return undefined;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function calculateAdaptivePollIntervalMinutes(
	values: Array<string | null | undefined>,
): number {
	const timestamps = values
		.map((value) => value ? Date.parse(value) : Number.NaN)
		.filter(Number.isFinite)
		.sort((left, right) => right - left)
		.slice(0, MAX_PUBLICATION_SAMPLES);
	if (timestamps.length < 2) {
		return DEFAULT_POLL_INTERVAL_MINUTES;
	}

	const gaps: number[] = [];
	for (let index = 0; index < timestamps.length - 1; index += 1) {
		const gap = timestamps[index] - timestamps[index + 1];
		if (gap > 0) {
			gaps.push(gap);
		}
	}
	if (!gaps.length) {
		return DEFAULT_POLL_INTERVAL_MINUTES;
	}

	const totalGap = gaps.reduce((total, gap) => total + gap, 0);
	const postsPerHour = gaps.length / (totalGap / MILLISECONDS_PER_HOUR);
	if (postsPerHour > 1) {
		return MIN_POLL_INTERVAL_MINUTES;
	}
	if (postsPerHour < 0.01) {
		return MAX_FEED_POLL_INTERVAL_MINUTES;
	}

	const averageGapMinutes = totalGap / gaps.length / MILLISECONDS_PER_MINUTE;
	return clampPollIntervalMinutes(averageGapMinutes / 3);
}

export function calculateNextPollAt(now: Date, intervalMinutes: number): string {
	return new Date(
		now.getTime() + intervalMinutes * MILLISECONDS_PER_MINUTE,
	).toISOString();
}
