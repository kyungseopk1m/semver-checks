cat >dist/cjs/package.json <<!EOF
{
    "type": "commonjs"
}
!EOF

cat >dist/mjs/package.json <<!EOF
{
    "type": "module"
}
!EOF

# src/extract/worker-path.ts is written for CommonJS (__dirname); ESM has only import.meta.
cat >dist/mjs/extract/worker-path.js <<'!EOF'
import { fileURLToPath } from 'url';
export const extractWorkerPath = fileURLToPath(new URL('./extract-worker.js', import.meta.url));
!EOF
