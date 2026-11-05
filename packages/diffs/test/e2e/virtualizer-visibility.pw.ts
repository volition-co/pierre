import { expect, test } from '@playwright/test';

const scenarios = [
  { hiddenTarget: 'file', transition: 'starts-hidden' },
  { hiddenTarget: 'parent', transition: 'starts-hidden' },
  { hiddenTarget: 'root', transition: 'starts-hidden' },
  { hiddenTarget: 'parent', transition: 'hide-during-mount' },
  { hiddenTarget: 'parent', transition: 'show-during-mount' },
] as const;

for (const kind of ['file', 'diff'] as const) {
  for (const { hiddenTarget, transition } of scenarios) {
    test(`${kind} ${transition} with display:none on its ${hiddenTarget}`, async ({
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
          const parent = document.createElement('div');
          const host = document.createElement('diffs-container');
          host.style.display = 'block';
          parent.append(host);
          root.append(parent);
          const hidden = ${JSON.stringify(hiddenTarget)} === 'file' ? host : ${JSON.stringify(hiddenTarget)} === 'parent' ? parent : root;
          const transition = ${JSON.stringify(transition)};
          if (transition !== 'hide-during-mount') hidden.style.display = 'none';
          const show = document.createElement('button');
          show.textContent = 'Show file';
          show.onclick = () => { hidden.style.display = 'block'; };
          document.body.append(show, root);
          const virtualizer = new Virtualizer();
          virtualizer.setup(root, parent);
          const file = { name: 'hidden.txt', contents: 'visible code\\n' };
          const options = { disableFileHeader: true };
          if (${JSON.stringify(kind)} === 'file') {
            const instance = new VirtualizedFile(options, virtualizer);
            instance.render({ file, fileContainer: host });
          } else {
            const instance = new VirtualizedFileDiff(options, virtualizer);
            instance.render({ fileDiff: parseDiffFromFile(null, file), fileContainer: host });
          }
          if (transition === 'hide-during-mount') hidden.style.display = 'none';
          if (transition === 'show-during-mount') hidden.style.display = 'block';
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          document.body.dataset.hiddenFixtureReady = 'true';
        `,
      });
      await expect(page.locator('body')).toHaveAttribute(
        'data-hidden-fixture-ready',
        'true'
      );
      if (transition === 'show-during-mount') {
        await expect(
          page
            .locator('[data-line]')
            .filter({ hasText: 'visible code' })
            .first()
        ).toBeVisible();
        await expect(page.locator('[data-placeholder]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-placeholder]')).toHaveCount(1);
        await expect(page.locator('[data-line]')).toHaveCount(0);
      }

      await page.getByRole('button', { name: 'Show file' }).click();
      await expect(
        page.locator('[data-line]').filter({ hasText: 'visible code' }).first()
      ).toBeVisible();
      await expect(page.locator('[data-placeholder]')).toHaveCount(0);
    });
  }
}
