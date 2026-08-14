import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'player-web');
const requestedOutput = process.argv[2];

if (!requestedOutput || !path.isAbsolute(requestedOutput)) {
  throw new Error('Pass an absolute path to an empty deployment staging directory.');
}

const outputRoot = path.resolve(requestedOutput);
const relativeToRepository = path.relative(repositoryRoot, outputRoot);
if (!relativeToRepository || (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository))) {
  throw new Error('The deployment staging directory must be outside the repository.');
}

if (existsSync(outputRoot) && readdirSync(outputRoot).length > 0) {
  throw new Error('The deployment staging directory must be empty.');
}
mkdirSync(outputRoot, { recursive: true });

const excludedDirectories = new Set(['.next', '.vercel', 'node_modules']);
cpSync(sourceRoot, outputRoot, {
  recursive: true,
  filter(source) {
    const relative = path.relative(sourceRoot, source);
    return !relative.split(path.sep).some((segment) => excludedDirectories.has(segment));
  }
});

const sharedRoot = path.join(outputRoot, '.shared', 'player-app', 'src');
mkdirSync(sharedRoot, { recursive: true });
cpSync(path.join(repositoryRoot, 'player-app', 'src', 'domain'), path.join(sharedRoot, 'domain'), { recursive: true });
mkdirSync(path.join(sharedRoot, 'data'), { recursive: true });
cpSync(
  path.join(repositoryRoot, 'player-app', 'src', 'data', 'playerRequests.ts'),
  path.join(sharedRoot, 'data', 'playerRequests.ts')
);

const tsconfigPath = path.join(outputRoot, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
tsconfig.compilerOptions.paths['@orbit/player-domain/*'] = ['./.shared/player-app/src/domain/*'];
tsconfig.compilerOptions.paths['@orbit/player-requests'] = ['./.shared/player-app/src/data/playerRequests.ts'];
writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

const nextConfigPath = path.join(outputRoot, 'next.config.ts');
const nextConfig = readFileSync(nextConfigPath, 'utf8')
  .replace("import path from 'node:path';\n\n", '')
  .replace("const repositoryRoot = path.resolve(process.cwd(), '..');", 'const repositoryRoot = process.cwd();');
if (!nextConfig.includes('const repositoryRoot = process.cwd();')) {
  throw new Error('Could not adapt the staged Next.js repository root.');
}
writeFileSync(nextConfigPath, nextConfig);

writeFileSync(path.join(outputRoot, 'vercel.json'), `${JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'nextjs',
  installCommand: 'npm ci',
  buildCommand: 'npm run build'
}, null, 2)}\n`);

console.log(`Staged Player Web deployment at ${outputRoot}`);
