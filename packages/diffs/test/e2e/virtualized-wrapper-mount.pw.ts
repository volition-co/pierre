import { expect, test } from '@playwright/test';

for (const kind of ['file', 'diff', 'files'] as const) {
  for (const hidden of [false, true]) {
    test(`${kind} mounts through containerWrapper (initially hidden: ${hidden})`, async ({
      page,
    }) => {
      await page.goto('/test/e2e/fixtures/diff-render.html');
      await page.waitForFunction(() => window.__diffReady === true);
      await page.addScriptTag({
        type: 'module',
        content: `
          import { Virtualizer, VirtualizedFile, VirtualizedFileDiff, parseDiffFromFile } from '/dist/index.js';
          window.__diffFixture.instance.cleanUp();
          document.body.replaceChildren();
          const root = document.createElement('div');
          root.style.cssText = 'height:600px;width:1000px;overflow:auto';
          root.dataset.wrapperFixture = '';
          const wrapper = document.createElement('div');
          root.append(wrapper);
          if (${hidden}) root.style.display = 'none';
          const show = document.createElement('button');
          show.textContent = 'Show file';
          show.onclick = () => { root.style.display = 'block'; };
          document.body.append(show, root);
          const virtualizer = new Virtualizer();
          virtualizer.setup(root, wrapper);
          const connect = virtualizer.connect.bind(virtualizer);
          virtualizer.connect = (host, instance) => {
            if (!host.isConnected || host.parentNode !== wrapper) {
              throw new Error('File registered before attachment to containerWrapper');
            }
            root.dataset.registered = 'true';
            return connect(host, instance);
          };
          const oldFile = { name: 'wrapper.txt', contents: 'before\\n' };
          const file = { name: 'wrapper.txt', contents: 'wrapper content\\n' };
          const options = { disableFileHeader: true };
          if (${JSON.stringify(kind)} === 'file') {
            new VirtualizedFile(options, virtualizer).render({ file, containerWrapper: wrapper });
          } else if (${JSON.stringify(kind)} === 'diff') {
            new VirtualizedFileDiff(options, virtualizer).render({
              fileDiff: parseDiffFromFile(oldFile, file), containerWrapper: wrapper,
            });
          } else {
            new VirtualizedFileDiff(options, virtualizer).render({
              oldFile, newFile: file, containerWrapper: wrapper,
            });
          }
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          root.dataset.ready = 'true';
        `,
      });
      const root = page.locator('[data-wrapper-fixture]');
      await expect(root).toHaveAttribute('data-ready', 'true');
      await expect(root).toHaveAttribute('data-registered', 'true');
      await expect(root.locator('diffs-container')).toHaveCount(1);
      if (hidden) {
        await expect(root.locator('[data-placeholder]')).toHaveCount(1);
        await expect(root.locator('[data-line]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Show file' }).click();
      }
      await expect(
        root
          .locator('[data-line]')
          .filter({ hasText: 'wrapper content' })
          .first()
      ).toBeVisible();
      await expect(root.locator('[data-placeholder]')).toHaveCount(0);
    });
  }
}
