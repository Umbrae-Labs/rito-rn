import { exportEngine, verifyEngine, root } from './engine.mjs';
import fs from 'node:fs';
import path from 'node:path';

const lock = JSON.parse(fs.readFileSync(path.join(root, 'engine.lock.json'), 'utf8'));
exportEngine(process.env.RITO_ENGINE_PROFILE ?? lock.defaultProfile);
verifyEngine();
