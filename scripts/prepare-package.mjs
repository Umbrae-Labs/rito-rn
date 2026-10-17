import { exportEngine, verifyEngine, root } from './engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { verifyPrebuilt } from './prebuilt.mjs';

exportEngine();
verifyEngine();
if (process.env.RITO_PACKAGE_MODE !== 'source') verifyPrebuilt();
else if (fs.existsSync(path.join(root, 'prebuilt'))) throw new Error('Source-only packing requires removing generated prebuilt artifacts first');
