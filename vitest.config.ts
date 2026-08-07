import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts'],
			thresholds: {
				statements: 90,
				lines: 90,
				functions: 90,
				branches: 85,
			},
		},
	},
});
