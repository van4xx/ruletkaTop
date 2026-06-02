/**
 * Jest config for the API. Uses ts-jest with the build tsconfig (which carries
 * the `@ruletka/shared-types` path mapping) so specs can import the shared
 * contracts the same way the app does.
 *
 * NOTE: authored as CommonJS (.js) rather than .ts so Jest can parse it without
 * requiring `ts-node` (which is not a dependency of this package). The specs
 * themselves are still transformed by ts-jest below.
 */
/** @type {import('jest').Config} */
const config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Spec-scoped tsconfig: re-includes *.spec.ts and adds @types/jest globals
        // (the build tsconfig.json excludes specs and omits jest types).
        tsconfig: 'tsconfig.spec.json',
        // Decorators / metadata need this; ts-jest reads it from tsconfig too.
        isolatedModules: false,
      },
    ],
  },
  moduleNameMapper: {
    // Mirror the tsconfig path mapping for runtime module resolution in tests.
    '^@ruletka/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^@ruletka/shared-types/(.*)$': '<rootDir>/../../packages/shared-types/src/$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
};

module.exports = config;
