import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		include: ['test/**/*.spec.ts'],
		server: {
			deps: {
				inline: [
					/@simplewebauthn\/server/,
					/@peculiar\/.*/,
					/tslib/,
					'@simplewebauthn/server',
					'tsyringe',
				],
			}
				],
			},
		},
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
});
