import { basename, resolve } from "node:path";

export function projectRootFromCwd(cwd = process.cwd()): string {
  return basename(resolve(cwd)) === "server"
    ? resolve(cwd, "..")
    : resolve(cwd);
}

export function resolveProjectPath(path: string, cwd = process.cwd()): string {
  if (path === ":memory:") return path;
  return resolve(projectRootFromCwd(cwd), path);
}
