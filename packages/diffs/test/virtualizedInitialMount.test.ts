import { expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, waitFor } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

class TestVirtualizedFile extends VirtualizedFile {
  getRenderedContentForTest() {
    return this.getRenderedFile();
  }
}

class TestVirtualizedFileDiff extends VirtualizedFileDiff {
  getRenderedContentForTest() {
    return this.getRenderedDiff();
  }
}

type TestInstance = TestVirtualizedFile | TestVirtualizedFileDiff;

for (const kind of ['file', 'diff'] as const) {
  for (const setupBeforeRender of [false, true]) {
    test(`${kind} mounts placeholders without synchronous geometry reads (setup before render: ${setupBeforeRender})`, async () => {
      const dom = installDom();
      const { manager } = await createInitializedManager({
        theme: 'pierre-dark',
      });
      const root = createRoot({ height: 600 });
      Object.defineProperty(root, 'scrollHeight', { value: 10_000 });
      const virtualizer = new Virtualizer({ intersectionObserverMargin: 0 });
      const measureTop = spyOn(virtualizer, 'getOffsetInScrollContainer');
      const measureVisibility = spyOn(virtualizer, 'isInstanceVisible');
      const instances: TestInstance[] = [];
      const containers: HTMLElement[] = [];
      const file: FileContents = {
        name: 'visibility.txt',
        contents:
          Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n') +
          '\n',
        cacheKey: 'mount:new',
      };
      const fileDiff = parseDiffFromFile(
        { name: file.name, contents: 'before\n', cacheKey: 'mount:old' },
        file
      );
      const expected = kind === 'file' ? file : fileDiff;
      const render = (instance: TestInstance, container?: HTMLElement) =>
        instance instanceof TestVirtualizedFile
          ? instance.render({ file, fileContainer: container })
          : instance.render({ fileDiff, fileContainer: container });

      try {
        if (setupBeforeRender) {
          virtualizer.setup(root);
        }
        for (let index = 0; index < 3; index++) {
          const container = document.createElement('diffs-container');
          const instance =
            kind === 'file'
              ? new TestVirtualizedFile(
                  {},
                  virtualizer,
                  undefined,
                  manager,
                  () => undefined
                )
              : new TestVirtualizedFileDiff(
                  {},
                  virtualizer,
                  undefined,
                  manager,
                  () => undefined
                );
          // jsdom has no layout. Stack files by their estimated heights and
          // move their rectangles with the scroll container.
          container.getBoundingClientRect = () => {
            const top =
              instances
                .slice(0, index)
                .reduce((height, item) => height + item.height, 0) -
              root.scrollTop;
            return {
              top,
              bottom: top + instance.height,
              left: 0,
              right: 1000,
              width: 1000,
              height: instance.height,
              x: 0,
              y: top,
              toJSON() {
                return {};
              },
            };
          };
          root.appendChild(container);
          instances.push(instance);
          containers.push(container);
          render(instance, container);
          // A second host render before observer delivery must also stay cheap.
          render(instance);
          expect(instance.top).toBeUndefined();
          expect(instance.getRenderedContentForTest()).toBeUndefined();
          expect(
            container.shadowRoot?.querySelector<HTMLElement>(
              '[data-placeholder]'
            )?.style.height
          ).toBe(`${instance.height}px`);
          expect(instance.height).toBeGreaterThan(600);
        }
        expect(measureTop).not.toHaveBeenCalled();
        expect(measureVisibility).not.toHaveBeenCalled();

        const Observer = dom.window.MutationObserver;
        const observer = new Observer(() => {});
        observer.observe(containers[1].shadowRoot!, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        try {
          expect(instances[1].onRender(false)).toBe(false);
          expect(instances[1].onRender(true)).toBe(false);
          expect(observer.takeRecords()).toHaveLength(0);
          expect(instances[1].top).toBeUndefined();
        } finally {
          observer.disconnect();
        }

        if (!setupBeforeRender) {
          virtualizer.setup(root);
        }
        // Visibility arrives only once every placeholder contributes its height.
        dom.triggerIntersectionObserver(containers[0], true);
        instances[0].onRender(false);
        expect(instances[0].top).toBe(0);
        expect(instances[0].getRenderedContentForTest()).toBe(expected);
        expect(
          containers[0].shadowRoot?.querySelector('[data-line]')
        ).not.toBeNull();
        expect(
          containers[2].shadowRoot?.querySelector('[data-placeholder]')
        ).not.toBeNull();

        const lastTop = instances[0].height + instances[1].height;
        virtualizer.scrollTo({ top: lastTop });
        dom.triggerIntersectionObserver(containers[0], false);
        dom.triggerIntersectionObserver(containers[2], true);
        instances[0].onRender(false);
        instances[2].onRender(false);
        await waitFor(
          () => containers[2].shadowRoot?.querySelector('[data-line]') != null
        );
        expect(instances[2].top).toBe(lastTop);
        expect(instances[2].getRenderedContentForTest()).toBe(expected);
        expect(
          containers[2].shadowRoot?.querySelector('[data-line]')
        ).not.toBeNull();
        expect(
          containers[0].shadowRoot?.querySelector('[data-placeholder]')
        ).not.toBeNull();
      } finally {
        for (const instance of instances) {
          instance.cleanUp();
        }
        virtualizer.cleanUp();
        measureTop.mockRestore();
        measureVisibility.mockRestore();
        manager.terminate();
        dom.cleanup();
      }
    });
  }
}

for (const kind of ['file', 'diff', 'files'] as const) {
  for (const setupBeforeRender of [false, true]) {
    test(`${kind} mounts with only containerWrapper before virtualizer registration (setup before render: ${setupBeforeRender})`, async () => {
      const dom = installDom();
      const { manager } = await createInitializedManager({
        theme: 'pierre-dark',
      });
      const root = createRoot({ height: 600 });
      const wrapper = document.createElement('div');
      root.appendChild(wrapper);
      Object.defineProperty(root, 'scrollHeight', { value: 10_000 });
      const virtualizer = new Virtualizer();
      const originalConnect = virtualizer.connect.bind(virtualizer);
      let attachedAtRegistration: boolean | undefined;
      const connect = spyOn(virtualizer, 'connect').mockImplementation(
        (container, instance) => {
          attachedAtRegistration =
            container.isConnected && container.parentElement === wrapper;
          return originalConnect(container, instance);
        }
      );
      const oldFile: FileContents = {
        name: 'wrapper.txt',
        contents: 'before\n',
      };
      const file: FileContents = {
        name: 'wrapper.txt',
        contents: 'wrapper content\n',
      };
      const fileDiff = parseDiffFromFile(oldFile, file);
      const instance =
        kind === 'file'
          ? new TestVirtualizedFile({}, virtualizer, undefined, manager)
          : new TestVirtualizedFileDiff({}, virtualizer, undefined, manager);
      const render = () =>
        instance instanceof TestVirtualizedFile
          ? instance.render({ file, containerWrapper: wrapper })
          : kind === 'diff'
            ? instance.render({ fileDiff, containerWrapper: wrapper })
            : instance.render({
                oldFile,
                newFile: file,
                containerWrapper: wrapper,
              });

      try {
        if (setupBeforeRender) {
          virtualizer.setup(root, wrapper);
        }
        render();
        expect(attachedAtRegistration).toBe(true);
        const host = wrapper.querySelector('diffs-container');
        expect(host).not.toBeNull();
        expect(
          host?.shadowRoot?.querySelector('[data-placeholder]')
        ).not.toBeNull();
        if (!setupBeforeRender) {
          virtualizer.setup(root, wrapper);
        }
        dom.triggerIntersectionObserver(host!, true);
        await waitFor(
          () =>
            host?.shadowRoot?.textContent?.includes('wrapper content') === true
        );
        expect(host?.shadowRoot?.textContent).toContain('wrapper content');
        render();
        expect(wrapper.querySelectorAll('diffs-container')).toHaveLength(1);
        expect(wrapper.firstElementChild).toBe(host);
      } finally {
        instance.cleanUp();
        virtualizer.cleanUp();
        connect.mockRestore();
        manager.terminate();
        dom.cleanup();
      }
    });
  }
}
