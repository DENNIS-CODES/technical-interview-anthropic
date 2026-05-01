# TypeScript Interview Practice

Small Yarn Berry TypeScript workspace for coding interview drills.

## Commands

```sh
yarn test
```

Runs all `src/**/*.test.ts` files once with Vitest. This is the best default for interview practice because it starts fast, does not need Babel/Jest transforms, and handles TypeScript directly through Vite/esbuild.

```sh
yarn test:watch
```

Keeps Vitest running and reruns only affected tests while you edit.

```sh
yarn typecheck
```

Runs TypeScript without emitting JavaScript.

## Workflow

Create one problem file and one colocated test file:

- `src/problem-name.ts`
- `src/problem-name.test.ts`

Keep implementation exports small and test behavior directly.