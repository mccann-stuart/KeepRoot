import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		server: {
			deps: {
				inline: [
					/@simplewebauthn\/server/,
					/@peculiar\/.*/,
					/tslib/
				]
			}
		},
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
