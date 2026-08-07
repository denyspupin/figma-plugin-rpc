import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';

export default defineConfig([
	js.configs.recommended,
	...tseslint.configs.recommended,

	globalIgnores(['node_modules/**', 'dist/**', '*.config.{js,ts}']),

	{
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.check.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
]);
