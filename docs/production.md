# Keep it out of production

Back to the [README](https://github.com/yomete/canvas-scan#readme).

`canvas-scan/auto` is a development tool. `canvas-scan init --write` adds the import with no condition, and bundlers include that import in production builds. Guard the import before you commit, and keep the guard synchronous. A dynamic import evaluates after your app's own imports and after React, and canvas-scan then warns that it started late. Do not replace the import with a dynamic import behind `import.meta.env.DEV`.

**Next.** In `instrumentation-client.ts`, replace the import with a `require` behind `process.env.NODE_ENV`. Next replaces `process.env.NODE_ENV` at build time and drops the dead branch, so a production build contains no canvas-scan code. In development the `require` is synchronous, so canvas-scan still runs before the app code.

```ts
if (process.env.NODE_ENV === 'development') {
  require('canvas-scan/auto');
}
```

**Vite.** Keep the static import on the first line of your entry. In `vite.config.ts`, alias `canvas-scan/auto` to an empty module when `command === 'build'`. Development keeps the first-import order, and a production build contains no canvas-scan code.

```ts
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  resolve: {
    alias: command === 'build' ? { 'canvas-scan/auto': 'data:text/javascript,' } : {},
  },
}));
```

`canvas-scan init --write` prints the pattern for the framework it wired.
