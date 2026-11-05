import { expect, test } from 'bun:test';

import { Virtualizer } from '../src/components/Virtualizer';
import { installDom } from './domHarness';

// Match the browser rectangle when display:none removes a file from layout.
function emptyRect(): DOMRect {
  return {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  };
}

// Hold frames so visibility and read/write ordering can be checked on the very
// first paint, without delivering any IntersectionObserver events.
function createFixture(intersectionObserverMargin = 0) {
  const dom = installDom();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const root = document.createElement('div');
  const content = document.createElement('div');
  root.appendChild(content);
  document.body.appendChild(root);
  root.scrollTop = 1200;
  Object.defineProperty(root, 'scrollHeight', { value: 10_000 });
  root.getBoundingClientRect = () => ({
    top: 100,
    bottom: 700,
    left: 0,
    right: 1000,
    width: 1000,
    height: 600,
    x: 0,
    y: 100,
    toJSON() {
      return {};
    },
  });
  const virtualizer = new Virtualizer({ intersectionObserverMargin });
  const events: string[] = [];
  const items = [0, 1000, 1500, 9000].map((top, index) => {
    const container = document.createElement('diffs-container');
    content.appendChild(container);
    Object.defineProperty(container, 'offsetHeight', {
      get: () => (container.style.display === 'none' ? 0 : 500),
    });
    container.getBoundingClientRect = () => {
      events.push(`read:${index}`);
      const rect = root.getBoundingClientRect();
      const y = rect.top + top - root.scrollTop;
      return {
        top: y,
        bottom: y + 500,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: 500,
        x: rect.x,
        y,
        toJSON() {
          return {};
        },
      };
    };
    const instance = {
      visible: false,
      onRender() {
        events.push(`render:${index}`);
        return false;
      },
      reconcileHeights() {
        return false;
      },
      setVisibility(visible: boolean) {
        events.push(`visibility:${index}`);
        this.visible = visible;
      },
    };
    return { container, instance };
  });
  return {
    dom,
    root,
    content,
    virtualizer,
    events,
    items,
    frames,
    cleanup() {
      virtualizer.cleanUp();
      dom.cleanup();
    },
  };
}

for (const setupBeforeConnect of [false, true]) {
  test(`resolves initial visibility before the first frame with batched reads (setup before connect: ${setupBeforeConnect})`, async () => {
    const fixture = createFixture();
    const { root, content, virtualizer, events, items } = fixture;
    try {
      if (setupBeforeConnect) {
        virtualizer.setup(root, content);
      }
      for (const { container, instance } of items) {
        virtualizer.connect(container, instance);
      }
      if (!setupBeforeConnect) {
        virtualizer.setup(root, content);
      }
      expect(events).toEqual([]);
      await Promise.resolve();

      // The root starts below the document top and is already scrolled. Only
      // the middle two files intersect its viewport at these coordinates.
      expect(items.map(({ instance }) => instance.visible)).toEqual([
        false,
        true,
        true,
        false,
      ]);
      expect(events.slice(0, 4)).toEqual([
        'read:0',
        'read:1',
        'read:2',
        'read:3',
      ]);
      expect(events.indexOf('visibility:1')).toBeGreaterThan(3);
      expect(events.indexOf('render:1')).toBeGreaterThan(3);
      expect(virtualizer.getWindowSpecs().top).toBe(200);
    } finally {
      fixture.cleanup();
    }
  });
}

test('initial measurement respects observer results and disconnected files', async () => {
  const fixture = createFixture();
  const { root, content, virtualizer, events, items, dom } = fixture;
  try {
    virtualizer.setup(root, content);
    for (const { container, instance } of items) {
      virtualizer.connect(container, instance);
    }
    // A real observer result takes precedence over the initial vertical
    // estimate (e.g. a file clipped by an intervening ancestor).
    dom.triggerIntersectionObserver(items[1].container, false);
    virtualizer.disconnect(items[2].container);
    await Promise.resolve();

    expect(items[1].instance.visible).toBe(false);
    expect(events).not.toContain('read:1');
    expect(events).not.toContain('read:2');
    expect(events).not.toContain('render:2');
    expect(events).not.toContain('visibility:1');
    expect(events).not.toContain('visibility:2');
  } finally {
    fixture.cleanup();
  }
});

test('cleanup cancels the initial mount microtask', async () => {
  const fixture = createFixture();
  const { root, content, virtualizer, events, items } = fixture;
  try {
    virtualizer.setup(root, content);
    for (const { container, instance } of items) {
      virtualizer.connect(container, instance);
    }
    virtualizer.cleanUp();
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(fixture.frames.size).toBe(0);
  } finally {
    fixture.cleanup();
  }
});

test('zero-size files stay hidden until the observer reports visible layout', async () => {
  const fixture = createFixture(4000);
  const { root, content, virtualizer, items, dom, events } = fixture;
  const { container, instance } = items[1];
  const measure = container.getBoundingClientRect;
  try {
    container.style.display = 'none';
    container.getBoundingClientRect = emptyRect;
    virtualizer.setup(root, content);
    virtualizer.connect(container, instance);
    await Promise.resolve();
    expect(instance.visible).toBe(false);
    expect(events).not.toContain('visibility:1');

    container.style.display = '';
    container.getBoundingClientRect = measure;
    dom.triggerIntersectionObserver(container, true);
    expect(instance.visible).toBe(true);
    expect(events).toContain('visibility:1');
  } finally {
    fixture.cleanup();
  }
});

for (const initiallyHidden of [false, true]) {
  test(`initial visibility uses the final layout when a file starts ${initiallyHidden ? 'hidden' : 'shown'} and toggles during mounting`, async () => {
    const fixture = createFixture(4000);
    const { root, content, virtualizer, items, events } = fixture;
    const { container, instance } = items[1];
    const measure = container.getBoundingClientRect;
    try {
      container.style.display = initiallyHidden ? 'none' : 'block';
      container.getBoundingClientRect = () =>
        container.style.display === 'none' ? emptyRect() : measure();
      virtualizer.setup(root, content);
      virtualizer.connect(container, instance);
      expect(events).toEqual([]);

      // Host mounting can change pane visibility after the child connects but
      // before the queued batch measures its final layout.
      container.style.display = initiallyHidden ? 'block' : 'none';
      await Promise.resolve();
      expect(instance.visible).toBe(initiallyHidden);
    } finally {
      fixture.cleanup();
    }
  });
}

test('initial visibility uses the document viewport and scroll position', async () => {
  const fixture = createFixture();
  const { root, virtualizer, items, dom } = fixture;
  const originalHeight = Object.getOwnPropertyDescriptor(
    globalThis,
    'innerHeight'
  );
  try {
    Object.defineProperty(globalThis, 'innerHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 10_000,
    });
    Object.defineProperty(dom.window, 'scrollY', {
      get: () => root.scrollTop,
    });
    const rect = root.getBoundingClientRect();
    root.getBoundingClientRect = () => ({
      top: 0,
      bottom: 600,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      x: rect.x,
      y: 0,
      toJSON() {
        return {};
      },
    });
    virtualizer.setup(document);
    for (const { container, instance } of items) {
      virtualizer.connect(container, instance);
    }
    await Promise.resolve();
    expect(items.map(({ instance }) => instance.visible)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(virtualizer.getWindowSpecs().top).toBe(200);
  } finally {
    fixture.cleanup();
    if (originalHeight == null) {
      Reflect.deleteProperty(globalThis, 'innerHeight');
    } else {
      Object.defineProperty(globalThis, 'innerHeight', originalHeight);
    }
  }
});
