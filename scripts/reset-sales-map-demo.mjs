import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

export const getSalesMapDemoResetSignalPath = (workspaceRoot) => path.resolve(
  workspaceRoot,
  '.orbit',
  'sales-map-demo-reset'
);

export const requestSalesMapDemoReset = async (workspaceRoot = repositoryRoot) => {
  const signalDirectory = path.resolve(workspaceRoot, '.orbit');
  const signalPath = getSalesMapDemoResetSignalPath(workspaceRoot);
  const relativeSignalPath = path.relative(signalDirectory, signalPath);

  if (
    !relativeSignalPath
    || relativeSignalPath.startsWith('..')
    || path.isAbsolute(relativeSignalPath)
  ) {
    throw new Error('The sales-map reset signal must stay inside the workspace .orbit directory.');
  }

  await mkdir(signalDirectory, { recursive: true });
  await writeFile(
    signalPath,
    `${Date.now()}:${process.pid}:${process.hrtime.bigint()}\n`,
    'utf8'
  );
  return signalPath;
};

const isDirectRun = Boolean(
  process.argv[1]
  && path.resolve(process.argv[1]) === scriptPath
);

if (isDirectRun) {
  try {
    await requestSalesMapDemoReset();
    console.log(
      'Sales-map demo reset requested. Running sales-map:dev pages will reload; otherwise the next page load starts from the default state.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to reset the sales-map demo: ${message}`);
    process.exitCode = 1;
  }
}
