/// <reference types="electron-vite/node" />

/** Vite `?raw` string imports; SQL migrations are bundled into the main process this way. */
declare module '*.sql?raw' {
  const content: string
  export default content
}
