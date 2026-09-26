// Vite's `?raw` suffix imports a file as a string (used by tests that read the shipped stylesheet).
declare module '*.css?raw' {
  const text: string;
  export default text;
}
