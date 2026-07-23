/**
 * Minimal ambient declaration for the ONE Node API `vite.config.ts` uses (the build stamp
 * shells out to git). This project deliberately carries no `@types/node`: nothing in `src/`
 * runs in Node, so pulling the whole Node typings in for a single `execSync` would be a
 * dependency for a comment's worth of code. Declared here instead, narrowly.
 */
declare module "node:child_process" {
  export function execSync(
    command: string,
    options?: { encoding?: string; stdio?: (string | number | null)[] },
  ): string;
}
