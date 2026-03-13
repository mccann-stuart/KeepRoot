import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['dashboard/test/**/*.spec.ts'],
	},
});
