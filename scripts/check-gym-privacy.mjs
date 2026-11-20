import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const terms = (process.env.GYM_FORBIDDEN_TERMS ?? '').split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
if (terms.length === 0) {
  console.warn('GYM PRIVACY CHECK SKIPPED: GYM_FORBIDDEN_TERMS is unset or blank');
} else {
  const result = spawnSync('git', ['grep', '-Fiq', '-f', '-', '--', '.'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    input: terms.join('\n'),
  });
  if (result.status === 0) {
    console.error('Forbidden gym term in tracked files');
    process.exitCode = 1;
  } else if (result.status === 1) {
    console.log('Gym privacy check passed');
  } else {
    console.error('Could not check tracked files for forbidden gym terms');
    process.exitCode = 2;
  }
}
