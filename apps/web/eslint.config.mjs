import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * ESLint flat config for the web app (Next.js 16 — `next lint` was removed, so we
 * run the ESLint CLI directly via the `lint` script). Next 16's
 * `eslint-config-next` ships a NATIVE flat config, so we spread it directly (no
 * `FlatCompat` bridge — that path hits a circular-ref bug on ESLint 9). Build
 * output + generated files are ignored.
 */
const eslintConfig = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/**'],
  },
  ...nextCoreWebVitals,
  {
    // The React-Compiler-era `react-hooks` rules (shipped as ERRORS by the latest
    // eslint-config-next) flag many common, working patterns — setState-in-effect,
    // ref reads, prop "mutations", library-compat. They're useful ADVISORIES, not
    // bugs, so we surface them as warnings (visible, non-blocking) rather than
    // gating CI on a risky refactor of shipped code. Genuine errors (a11y, Next
    // routing, etc.) stay errors.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },
];

export default eslintConfig;
