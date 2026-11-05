import { expect, spyOn, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import type { FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, waitFor } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

class TestVirtualizedFileDiff extends VirtualizedFileDiff {
  getRenderedDiffForTest(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }
}

function createDiff(cacheKey: string, contents: string): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name: 'visibility.txt',
      contents: 'before\n',
      cacheKey: `${cacheKey}:old`,
    },
    {
      name: 'visibility.txt',
      contents: `${contents}\n`,
      cacheKey: `${cacheKey}:new`,
    }
  );
}

function createVirtualizer(isVisible: boolean): Virtualizer {
  return {
    config: { resizeDebugging: false },
    type: 'simple',
    connect() {},
    disconnect() {},
    getOffsetInScrollContainer() {
      return 0;
    },
    getWindowSpecs() {
      return { top: 0, bottom: 1000 };
    },
    instanceChanged() {},
    isInstanceVisible() {
      return isVisible;
    },
    markDOMDirty() {},
    requestHeightReconcile() {},
  } as unknown as Virtualizer;
}

test('renders a replacement after an off-screen placeholder', async () => {
  const dom = installDom();
  const { manager } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const container = document.createElement('diffs-container');
  const instance = new TestVirtualizedFileDiff(
    {},
    createVirtualizer(false),
    undefined,
    manager,
    () => undefined
  );
  const firstDiff = createDiff('first', 'first value');
  const replacementDiff = createDiff('replacement', 'replacement value');

  try {
    instance.render({ fileDiff: firstDiff, fileContainer: container });
    expect(
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length
    ).toBe(1);
    expect(instance.getRenderedDiffForTest()).toBeUndefined();

    instance.render({
      fileDiff: replacementDiff,
      fileContainer: container,
    });
    expect(
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length
    ).toBe(0);
    expect(instance.getRenderedDiffForTest()).toBe(replacementDiff);
  } finally {
    instance.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});

test('mounts placeholders without offset reads and renders before observer delivery', async () => {
  const dom = installDom();
  const { manager } = await createInitializedManager({ theme: 'pierre-dark' });
  const root = createRoot();
  const virtualizer = new Virtualizer();
  const instances: TestVirtualizedFileDiff[] = [];
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
      const instance = new TestVirtualizedFileDiff(
        {},
        virtualizer,
        undefined,
        manager,
        () => undefined
      );
      instances.push(instance);
      const fileDiff = createDiff(`mount-${index}`, `value ${index}`);
      instance.render({ fileDiff, fileContainer: container });
      // A repeat render before observation must also avoid measuring top.
      instance.render({ fileDiff, fileContainer: container });
      const placeholder =
        container.shadowRoot?.querySelector<HTMLElement>('[data-placeholder]');
      expect(parseFloat(placeholder?.style.height ?? '0')).toBe(
        instance.height
      );
      expect(instance.height).toBeGreaterThan(0);
      expect(instance.top).toBeUndefined();
      expect(instance.getRenderedDiffForTest()).toBeUndefined();
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
      expect(instance.getRenderedDiffForTest()).toBeUndefined();
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
