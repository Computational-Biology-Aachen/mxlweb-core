interface ImportMeta {
  readonly env: Record<string, string | boolean | undefined> & { DEV: boolean };
}

declare module "*?worker&url" {
  const url: string;
  export default url;
}
