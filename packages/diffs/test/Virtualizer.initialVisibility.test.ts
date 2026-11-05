import { expect, test } from 'bun:test';

import { Virtualizer } from '../src/components/Virtualizer';
import { createRoot, installDom } from './domHarness';

test.each([false, true])(
  'batches initial measurements before rendering (setup before connect: %s)',
  async (setupFirst) => {
    const dom = installDom();
    const root = createRoot();
    const virtualizer = new Virtualizer();
    const events: string[] = [];
    const instances = [0, 1, 2].map((index) => ({
      onRender() {
        events.push(`render ${index}`);
        return false;
      },
      reconcileHeights() {
        return false;
      },
      setVisibility(visible: boolean) {
        events.push(`visible ${index} ${visible}`);
      },
    }));
    try {
      if (setupFirst) virtualizer.setup(root);
      for (const [index, instance] of instances.entries()) {
        const container = document.createElement('div');
        root.appendChild(container);
        container.getBoundingClientRect = () => {
          events.push(`read ${index}`);
          const top = index === 1 ? 10_000 : 0;
          return {
            ...root.getBoundingClientRect(),
            top,
            bottom: top + 100,
            height: 100,
          };
        };
        virtualizer.connect(container, instance);
        if (index === 2) virtualizer.disconnect(container);
      }
      if (!setupFirst) virtualizer.setup(root);
      expect(events).toEqual([]);
      // No animation frame or observer delivery is needed for the initial pass.
      await Promise.resolve();
      expect(events).toContain('visible 0 true');
      expect(events).toContain('render 0');
      expect(events).not.toContain('visible 1 true');
      expect(events.some((event) => event.endsWith(' 2'))).toBe(false);
      const firstVisibility = events.indexOf('visible 0 true');
      expect(events.indexOf('read 0')).toBeLessThan(firstVisibility);
      expect(events.lastIndexOf('read 1')).toBeLessThan(firstVisibility);
      expect(firstVisibility).toBeLessThan(events.indexOf('render 0'));
    } finally {
      virtualizer.cleanUp();
      dom.cleanup();
    }
  }
);

test('cleanup cancels pending initial visibility work', async () => {
  const dom = installDom();
  const virtualizer = new Virtualizer();
  try {
    const root = createRoot();
    const container = document.createElement('div');
    root.appendChild(container);
    virtualizer.setup(root);
    const unexpected = () => {
      throw new Error('Work ran after cleanup');
    };
    virtualizer.connect(container, {
      onRender: unexpected,
      reconcileHeights: unexpected,
      setVisibility: unexpected,
    });
    virtualizer.cleanUp();
    container.getBoundingClientRect = unexpected;
    await Promise.resolve();
  } finally {
    virtualizer.cleanUp();
    dom.cleanup();
  }
});
