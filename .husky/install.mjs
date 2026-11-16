// Installs the Git hooks in .husky/ (npm runs this as `prepare` after `npm install`). Skipped in CI and on Vercel
// (both set CI), and when Husky is not installed, such as an install that omits devDependencies.
if (process.env.CI) process.exit(0);
try {
  const { default: husky } = await import('husky');
  const msg = husky();
  if (msg) console.log(msg);
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}
