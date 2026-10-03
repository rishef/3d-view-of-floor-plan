export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export const slug = (s) => (s || 'project').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project';

export function saveProject(app) {
  downloadText(JSON.stringify(app.doc.toJSON(), null, 1), `${slug(app.doc.name)}.kbim.json`, 'application/json');
  app.status('Project saved as a .kbim.json file');
}

export function openProject(app) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.kbim';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      app.loadProject(JSON.parse(await file.text()));
      app.status(`Opened ${file.name}`);
    } catch (err) {
      app.status(`Could not open ${file.name}: ${err.message}`, 'warn');
    }
  });
  input.click();
}
