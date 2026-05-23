import init, * as vizCore from 'viz-core';

let initialized: Promise<typeof vizCore> | null = null;

export function loadVizCore(): Promise<typeof vizCore> {
  if (!initialized) {
    initialized = init().then(() => vizCore);
  }
  return initialized;
}

export type VizCore = typeof vizCore;
