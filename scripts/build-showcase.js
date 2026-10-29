const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'web');
const outputRoot = path.join(projectRoot, 'dist');

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.cpSync(sourceRoot, outputRoot, { recursive: true });

function htmlFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? htmlFiles(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}

const additions = [
  '<link rel="icon" type="image/x-icon" href="/assets/favicon-casa-sao-miguel.ico?v=1">',
  '<link rel="stylesheet" href="/theme.css">',
  '<link rel="stylesheet" href="/showcase.css">',
  '<script src="/demo-api.js"></script>'
].join('');

for (const file of htmlFiles(outputRoot)) {
  let html = fs.readFileSync(file, 'utf8');
  if (path.relative(outputRoot, file).toLowerCase() === 'index.html' && !html.includes('<a class="csm-sidebar-brand"')) {
    const logo = '<a class="csm-sidebar-brand" href="/" aria-label="Voltar à página inicial"><img src="/assets/casa-sao-miguel-logo.png?v=3" alt="Casa São Miguel"></a>';
    html = html.replace(/<main>/i, `<main class="csm-menu-sidebar">${logo}`);
  }
  if (!html.includes('/demo-api.js')) html = html.replace(/<\/head>/i, `${additions}</head>`);
  fs.writeFileSync(file, html, 'utf8');
}

console.log(`Simulação do Sistema gerada em ${path.relative(projectRoot, outputRoot)}.`);
