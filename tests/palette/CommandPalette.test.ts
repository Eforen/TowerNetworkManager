import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import CommandPalette from '@/palette/CommandPalette.vue';
import { useFsmStore, useGraphStore, useProjectStore, MemoryStorage } from '@/store';
import { resetRegistry } from '@/commands';

/**
 * Drive the palette end-to-end through mount + keyboard events. happy-dom
 * doesn't do real layout, so `offsetTop`/`offsetHeight` are zero; we stub
 * them below to exercise the scroll-into-view path.
 */
function makePalette() {
  setActivePinia(createPinia());
  resetRegistry();
  const fsm = useFsmStore();
  fsm.dispatch({ type: 'loadDone' });
  fsm.dispatch({ type: 'backtick' });
  return mount(CommandPalette, { attachTo: document.body });
}

function stubListLayout(
  wrapper: ReturnType<typeof mount>,
  rowHeight = 30,
  viewportHeight = 120,
): void {
  const ul = wrapper.find('ul.tni-palette__completions')
    .element as HTMLUListElement;
  Object.defineProperty(ul, 'clientHeight', {
    value: viewportHeight,
    configurable: true,
  });
  const items = ul.querySelectorAll('li');
  items.forEach((li, i) => {
    Object.defineProperty(li, 'offsetTop', {
      value: i * rowHeight,
      configurable: true,
    });
    Object.defineProperty(li, 'offsetHeight', {
      value: rowHeight,
      configurable: true,
    });
  });
}

async function typeInput(
  wrapper: ReturnType<typeof mount>,
  text: string,
): Promise<void> {
  const input = wrapper.find('input.tni-palette__input');
  const el = input.element as HTMLInputElement;
  el.value = text;
  el.selectionStart = text.length;
  el.selectionEnd = text.length;
  await input.trigger('input');
}

async function keydown(
  wrapper: ReturnType<typeof mount>,
  key: string,
  opts: { shiftKey?: boolean } = {},
): Promise<void> {
  await wrapper.find('input.tni-palette__input').trigger('keydown', {
    key,
    ...opts,
  });
}

function activeIndex(wrapper: ReturnType<typeof mount>): number {
  const items = wrapper.findAll('li');
  return items.findIndex((li) => li.classes('active'));
}

function candidateCount(wrapper: ReturnType<typeof mount>): number {
  return wrapper.findAll('li').length;
}

describe('CommandPalette – keyboard flow', () => {
  beforeEach(() => {
    // Clean slate per test; each test calls makePalette().
  });

  it("types 'add node ' and surfaces node-type completions", async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    const items = w.findAll('li').map((li) => li.text());
    expect(items.length).toBeGreaterThan(0);
    expect(activeIndex(w)).toBe(0);
    w.unmount();
  });

  it('ArrowDown walks through the candidate list', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    const n = candidateCount(w);
    expect(n).toBeGreaterThan(3);
    for (let i = 1; i < n; i++) {
      await keydown(w, 'ArrowDown');
      expect(activeIndex(w)).toBe(i);
    }
    // One more ArrowDown wraps back to index 0.
    await keydown(w, 'ArrowDown');
    expect(activeIndex(w)).toBe(0);
    w.unmount();
  });

  it('ArrowUp walks backwards and wraps to the last item', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    const n = candidateCount(w);
    await keydown(w, 'ArrowUp');
    expect(activeIndex(w)).toBe(n - 1);
    w.unmount();
  });

  // Regression: when the list is taller than its viewport, stepping past
  // the bottom must scroll the container so the active item stays visible.
  it('scrolls the container so the active item stays in view', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    stubListLayout(w, 30, 120); // 4 rows fit; list has >4 items.
    const ul = w.find('ul.tni-palette__completions')
      .element as HTMLUListElement;
    expect(ul.scrollTop).toBe(0);
    // Step down past the 4th row (viewport 0..120, rows at 0,30,60,90,120,...).
    for (let i = 0; i < 5; i++) await keydown(w, 'ArrowDown');
    // After 5 downs, selectedIndex = 5, item at offsetTop = 150, height 30.
    // New scrollTop = 150 + 30 - 120 = 60.
    expect(activeIndex(w)).toBe(5);
    expect(ul.scrollTop).toBe(60);
    w.unmount();
  });

  // Regression: going down then back up must both move the selection and
  // keep the container scrolled so the active item is visible.
  it('ArrowUp after ArrowDown tracks the selection and scrolls back up', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    stubListLayout(w, 30, 120);
    const ul = w.find('ul.tni-palette__completions')
      .element as HTMLUListElement;
    for (let i = 0; i < 6; i++) await keydown(w, 'ArrowDown');
    expect(activeIndex(w)).toBe(6);
    // Viewport 0..120 => after reaching row 6 (offsetTop 180, bottom 210),
    // scrollTop = 210 - 120 = 90.
    expect(ul.scrollTop).toBe(90);
    // Walk back up 6 rows; each step should decrement the index and keep
    // the item in view. By row 2 (offsetTop 60) we're still above the
    // current viewport bottom but below the top, so no scroll until we
    // hit row 2 where itemTop(60) < scrollTop(90) -> scrollTop becomes 60.
    const expected = [5, 4, 3, 2, 1, 0];
    const expectedScroll = [90, 90, 90, 60, 30, 0];
    for (let i = 0; i < expected.length; i++) {
      await keydown(w, 'ArrowUp');
      expect(activeIndex(w)).toBe(expected[i]);
      expect(ul.scrollTop).toBe(expectedScroll[i]);
    }
    w.unmount();
  });

  it('ArrowUp from the top wraps to the last item and scrolls into view', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    stubListLayout(w, 30, 120);
    const ul = w.find('ul.tni-palette__completions')
      .element as HTMLUListElement;
    const n = candidateCount(w);
    await keydown(w, 'ArrowUp');
    expect(activeIndex(w)).toBe(n - 1);
    // Last row offsetTop = (n-1)*30; bottom = n*30. scrollTop = n*30 - 120.
    expect(ul.scrollTop).toBe(n * 30 - 120);
  });

  it('ArrowDown from the last item wraps to the top and scrolls into view', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    stubListLayout(w, 30, 120);
    const ul = w.find('ul.tni-palette__completions')
      .element as HTMLUListElement;
    const n = candidateCount(w);
    // Walk all the way down to the last item.
    for (let i = 0; i < n - 1; i++) await keydown(w, 'ArrowDown');
    expect(activeIndex(w)).toBe(n - 1);
    expect(ul.scrollTop).toBe(n * 30 - 120);
    // One more ArrowDown wraps to index 0 and must scroll back to the top.
    await keydown(w, 'ArrowDown');
    expect(activeIndex(w)).toBe(0);
    expect(ul.scrollTop).toBe(0);
  });

  it('Escape collapses completions without closing the palette', async () => {
    const w = makePalette();
    await typeInput(w, 'add node ');
    expect(w.findAll('li').length).toBeGreaterThan(0);
    await keydown(w, 'Escape');
    expect(w.findAll('li').length).toBe(0);
    // Palette still visible.
    expect(w.find('.tni-palette').exists()).toBe(true);
    w.unmount();
  });

  it('Tab accepts the currently-selected candidate (no duplicate)', async () => {
    const w = makePalette();
    await typeInput(w, 'add node');
    await keydown(w, 'Tab');
    const input = w.find('input.tni-palette__input')
      .element as HTMLInputElement;
    // A trailing space is auto-inserted so the next slot's completer
    // fires immediately; the important invariant is no `add add` duplication.
    expect(input.value).toBe('add node ');
    w.unmount();
  });

  // Regression for the user-reported bug: typing `add link server[` char
  // by char should surface server[<id>] candidates, not wait for a trailing
  // space and backspace roundtrip before the popup appears.
  it('shows typed-ref candidates while typing `add link server[` char by char', async () => {
    setActivePinia(createPinia());
    resetRegistry();
    const fsm = useFsmStore();
    const graphStore = useGraphStore();
    graphStore.graph.addNode({ type: 'server', id: 'db01' });
    graphStore.graph.addNode({ type: 'server', id: 'db02' });
    fsm.dispatch({ type: 'loadDone' });
    fsm.dispatch({ type: 'backtick' });
    const w = mount(CommandPalette, { attachTo: document.body });

    const text = 'add link server[';
    for (let i = 1; i <= text.length; i++) {
      await typeInput(w, text.slice(0, i));
    }
    const values = w.findAll('li').map((li) => li.text());
    expect(values.some((v) => v.includes('server[db01]'))).toBe(true);
    expect(values.some((v) => v.includes('server[db02]'))).toBe(true);
    w.unmount();
  });

  // Regression for the user-reported bug: after Tab completes `add link ser`
  // to `add link server[`, the popup must reopen with the server ids instead
  // of collapsing.
  it('keeps the popup open with follow-up candidates after Tab-accepting a typed-ref prefix', async () => {
    setActivePinia(createPinia());
    resetRegistry();
    const fsm = useFsmStore();
    const graphStore = useGraphStore();
    graphStore.graph.addNode({ type: 'server', id: 'db01' });
    graphStore.graph.addNode({ type: 'server', id: 'db02' });
    fsm.dispatch({ type: 'loadDone' });
    fsm.dispatch({ type: 'backtick' });
    const w = mount(CommandPalette, { attachTo: document.body });

    await typeInput(w, 'add link ser');
    await keydown(w, 'Tab');

    const input = w.find('input.tni-palette__input')
      .element as HTMLInputElement;
    // Candidate ends with `[` so no space is auto-inserted.
    expect(input.value).toBe('add link server[');
    // Popup must still be visible with server ids.
    const values = w.findAll('li').map((li) => li.text());
    expect(values.some((v) => v.includes('server[db01]'))).toBe(true);
    expect(values.some((v) => v.includes('server[db02]'))).toBe(true);
    w.unmount();
  });

  // After completing a full typed-ref (`server[db01]`), the popup should
  // auto-advance to the `to` slot (since a space is inserted) and show
  // the next layer of candidates.
  it('auto-advances to the next slot after completing a full typed-ref', async () => {
    setActivePinia(createPinia());
    resetRegistry();
    const fsm = useFsmStore();
    const graphStore = useGraphStore();
    graphStore.graph.addNode({ type: 'server', id: 'db01' });
    graphStore.graph.addNode({ type: 'customer', id: 'organic-goat' });
    fsm.dispatch({ type: 'loadDone' });
    fsm.dispatch({ type: 'backtick' });
    const w = mount(CommandPalette, { attachTo: document.body });

    await typeInput(w, 'add link server[db');
    await keydown(w, 'Tab');

    const input = w.find('input.tni-palette__input')
      .element as HTMLInputElement;
    expect(input.value).toBe('add link server[db01] ');
    // Popup should now show `to` slot candidates (type[ stubs).
    const values = w.findAll('li').map((li) => li.text());
    expect(values.some((v) => v.includes('customer['))).toBe(true);
    w.unmount();
  });

  it('shows project-slug candidates for `load <slug>`', async () => {
    setActivePinia(createPinia());
    resetRegistry();
    const fsm = useFsmStore();
    const projectStore = useProjectStore();
    projectStore.setStorage(new MemoryStorage());
    projectStore.newProject('alpha');
    projectStore.save();
    projectStore.newProject('beta');
    projectStore.save();
    fsm.dispatch({ type: 'loadDone' });
    fsm.dispatch({ type: 'backtick' });
    const w = mount(CommandPalette, { attachTo: document.body });

    await typeInput(w, 'load ');
    const values = w.findAll('li').map((li) => li.text());
    expect(values.some((v) => v.includes('alpha'))).toBe(true);
    expect(values.some((v) => v.includes('beta'))).toBe(true);
    w.unmount();
  });

  it("Tab on 'add ' rewrites to the first 'add ...' command (no 'add add ...')", async () => {
    const w = makePalette();
    await typeInput(w, 'add ');
    await keydown(w, 'Tab');
    const input = w.find('input.tni-palette__input')
      .element as HTMLInputElement;
    // Candidate list is alphabetical; `add link` sorts before `add node`.
    // The critical invariant is that the first word is not duplicated.
    // A trailing space is auto-inserted so the next slot's completer fires.
    expect(input.value).toBe('add link ');
    expect(input.value.startsWith('add add')).toBe(false);
    w.unmount();
  });
});
