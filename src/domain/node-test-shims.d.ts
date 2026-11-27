declare module 'node:fs' {
  const fs: {
    readFileSync(path: string, encoding: 'utf8'): string;
    mkdtempSync(prefix: string): string;
    copyFileSync(src: string, dest: string): void;
    rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  };
  export default fs;
}

declare module 'node:os' {
  const os: {
    tmpdir(): string;
  };
  export default os;
}

declare module 'node:path' {
  const path: {
    resolve(...paths: string[]): string;
    join(...paths: string[]): string;
  };
  export default path;
}

declare const process: {
  cwd(): string;
};
