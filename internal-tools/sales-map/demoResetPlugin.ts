import path from 'node:path';
import type { Plugin } from 'vite';

type ResetEvent = 'add' | 'change';
type ResetListener = (filePath: string) => void;

export type DemoResetWatcher = {
  add: (filePath: string) => unknown;
  off: (event: ResetEvent, listener: ResetListener) => unknown;
  on: (event: ResetEvent, listener: ResetListener) => unknown;
};

export type DemoReloadPayload = Readonly<{
  path: '*';
  type: 'full-reload';
}>;

export const registerDemoResetWatcher = (
  watcher: DemoResetWatcher,
  reload: (payload: DemoReloadPayload) => void,
  resetSignalPath: string
) => {
  const resolvedResetSignalPath = path.resolve(resetSignalPath);
  const handleResetSignal = (changedPath: string) => {
    if (path.resolve(changedPath) !== resolvedResetSignalPath) return;
    reload({ type: 'full-reload', path: '*' });
  };

  watcher.add(resolvedResetSignalPath);
  watcher.on('add', handleResetSignal);
  watcher.on('change', handleResetSignal);

  return () => {
    watcher.off('add', handleResetSignal);
    watcher.off('change', handleResetSignal);
  };
};

export const createSalesMapDemoResetPlugin = (resetSignalPath: string): Plugin => ({
  name: 'sales-map-demo-reset',
  configureServer(server) {
    const dispose = registerDemoResetWatcher(
      {
        add: (filePath) => server.watcher.add(filePath),
        off: (event, listener) => server.watcher.off(event, listener),
        on: (event, listener) => server.watcher.on(event, listener)
      },
      (payload) => server.ws.send(payload),
      resetSignalPath
    );
    server.httpServer?.once('close', dispose);
  }
});
