import { expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { createRoot, installDom, makeFile, wait, waitFor } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

class TestVirtualizedFile extends VirtualizedFile {
  getRenderedFileForTest() {
    return this.getRenderedFile();
  }
}

// Simple-mode hide swaps rendered rows for a placeholder but must also drop
// the stored render range: re-showing with an unchanged scroll window
// recomputes an identical hunk-quantized range, and if the stale range
// survived, the base render early-returns and the file stays blank at its
// reserved height. Mirrors VirtualizedFileDiff.setVisibility.
test('re-showing a hidden file with an unchanged window re-renders content', async () => {
  const dom = installDom();
  const virtualizer = new Virtualizer();
  let instance: VirtualizedFile | undefined;
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);

    virtualizer.setup(root);
    // Settle the virtualizer's window specs before the first render so the
    // pre-hide and post-show renders resolve ranges against the same window.
    await wait(10);

    const file = makeFile('visibility.ts', 40);
    // Like the React hook, the owner renders the current file on request.
    instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      () => {
        instance?.render({ file });
      }
    );
    instance.render({ file, fileContainer: container });
    // Highlighting can finish after the first render; wait for actual rows.
    await waitFor(
      () => container.shadowRoot?.textContent?.includes('line 1') === true
    );
    const placeholderCount = (): number =>
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length ?? 0;
    expect(placeholderCount()).toBe(0);
    expect(container.shadowRoot?.textContent).toContain('line 1');

    // Virtualizer-driven hide: the placeholder render wipes the content rows.
    instance.setVisibility(false);
    await waitFor(() => placeholderCount() === 1);
    expect(placeholderCount()).toBe(1);

    // Virtualizer-driven re-show: setVisibility(true) followed by the
    // visible-instance render pass, which renders without forceRender.
    instance.setVisibility(true);
    instance.onRender(false);
    await waitFor(
      () =>
        placeholderCount() === 0 &&
        container.shadowRoot?.textContent?.includes('line 1') === true
    );
    expect(placeholderCount()).toBe(0);
    expect(container.shadowRoot?.textContent).toContain('line 1');
  } finally {
    instance?.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
    dom.cleanup();
  }
});

test('mounts placeholders without offset reads and renders before observer delivery', async () => {
  const dom = installDom();
  const { manager } = await createInitializedManager({ theme: 'pierre-dark' });
  const root = createRoot();
  const virtualizer = new Virtualizer();
  const instances: TestVirtualizedFile[] = [];
  const containers: HTMLElement[] = [];
  virtualizer.setup(root);
  const offsetRead = spyOn(virtualizer, 'getOffsetInScrollContainer');
  const visibilityRead = spyOn(virtualizer, 'isInstanceVisible');

  try {
    for (let index = 0; index < 50; index++) {
      const container = document.createElement('diffs-container');
      root.appendChild(container);
      containers.push(container);
      container.getBoundingClientRect = () => ({
        ...root.getBoundingClientRect(),
        top: index === 0 ? 0 : 10_000 + index * 1000,
        bottom: index === 0 ? 100 : 10_100 + index * 1000,
        height: 100,
      });
      const instance = new TestVirtualizedFile(
        {},
        virtualizer,
        undefined,
        manager,
        () => undefined
      );
      instances.push(instance);
      const file = {
        name: `mount-${index}.txt`,
        contents: `value ${index}\n`,
        cacheKey: `mount-${index}`,
      };
      instance.render({ file, fileContainer: container });
      // A repeat render before observation must also avoid measuring top.
      instance.render({ file, fileContainer: container });
      const placeholder =
        container.shadowRoot?.querySelector<HTMLElement>('[data-placeholder]');
      expect(parseFloat(placeholder?.style.height ?? '0')).toBe(
        instance.height
      );
      expect(instance.height).toBeGreaterThan(0);
      expect(instance.top).toBeUndefined();
      expect(instance.getRenderedFileForTest()).toBeUndefined();
    }
    expect(offsetRead).not.toHaveBeenCalled();
    expect(visibilityRead).not.toHaveBeenCalled();

    const first = containers[0];
    if (first == null) throw new Error('Missing first container');
    // No observer callback or animation frame is needed for initial visibility.
    await Promise.resolve();
    expect(first.shadowRoot?.querySelector('[data-line]')).not.toBeNull();
    await waitFor(() => first.shadowRoot?.querySelector('[data-line]') != null);
    expect(first.shadowRoot?.querySelector('[data-placeholder]')).toBeNull();
    expect(first.shadowRoot?.querySelector('pre')?.textContent).toContain(
      'value 0'
    );
    expect(offsetRead).toHaveBeenCalled();
    for (const instance of instances.slice(1)) {
      expect(instance.getRenderedFileForTest()).toBeUndefined();
    }
  } finally {
    for (const instance of instances) instance.cleanUp();
    virtualizer.cleanUp();
    offsetRead.mockRestore();
    visibilityRead.mockRestore();
    manager.terminate();
    dom.cleanup();
  }
});
