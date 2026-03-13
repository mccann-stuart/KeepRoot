import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/lib/service-worker';

describe('registerServiceWorker', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('registers the service worker when supported', async () => {
		const register = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', {
			serviceWorker: {
				register,
			},
		});

		await registerServiceWorker('/sw.js');

		expect(register).toHaveBeenCalledWith('/sw.js');
	});

	it('no-ops when service workers are unavailable', async () => {
		vi.stubGlobal('navigator', {});
		await expect(registerServiceWorker('/sw.js')).resolves.toBeUndefined();
	});
});
