import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const base = context.parentURL
      ? path.dirname(fileURLToPath(context.parentURL))
      : process.cwd();

    // 1. Relative or absolute path
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const target = path.resolve(base, specifier);
      for (const suffix of ['', '.js', '/index.js']) {
        const candidate = target + suffix;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return {
            url: pathToFileURL(candidate).href,
            shortCircuit: true,
            format: 'module',
          };
        }
      }
    }

    // 2. Bare specifier subpath (e.g. lodash/object)
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && specifier.includes('/')) {
      const parts = specifier.split('/');
      const pkg = parts[0];
      const sub = parts.slice(1).join('/');
      let current = base;
      while (current !== path.dirname(current)) {
        const candidateBase = path.join(current, 'node_modules', pkg, sub);
        for (const suffix of ['', '.js', '/index.js']) {
          const candidate = candidateBase + suffix;
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return {
              url: pathToFileURL(candidate).href,
              shortCircuit: true,
              format: 'commonjs',
            };
          }
        }
        current = path.dirname(current);
      }
    }

    throw error;
  }
}
