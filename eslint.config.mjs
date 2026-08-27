// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Bun transpila cada arquivo isoladamente — um import de puro tipo
      // sem `import type` vira import de valor no JS emitido e quebra em
      // runtime. tsconfig já barra isso via verbatimModuleSyntax; esta
      // regra é o autofix (`eslint --fix`) pra não corrigir na mão.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      // Fakes/mocks de teste implementam interfaces async por contrato
      // mesmo quando não fazem I/O nenhum — não vale marcar isso como erro.
      '@typescript-eslint/require-await': 'off',
      // bun-types tipa `expect(promise).rejects.toThrow()` como não-Promise,
      // mas a própria documentação do Bun usa `await` nesse padrão — sem
      // ele a asserção da rejeição não fica garantida antes do teste
      // terminar. Falso positivo dos types, não do código.
      '@typescript-eslint/await-thenable': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'eslint.config.mjs'],
  },
);
