import { beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GraphView from '@/view/GraphView.vue';
import { useGraphStore, useFsmStore } from '@/store';
import { simNodeForDrag } from '@/view/graphNodeDrag';
import type { GraphLayout } from '@/view/layout';
import type { SimNode } from '@/view/layout';

/**
 * Component test for edge hover tooltip. happy-dom doesn't lay out SVG
 * nor honor `getBoundingClientRect`, so we check data-binding + rendered
 * tooltip content rather than pixel positions.
 */
function makeView() {
  setActivePinia(createPinia());
  const fsm = useFsmStore();
  fsm.dispatch({ type: 'loadDone' });

  useGraphStore().parseText(
    [
      '!tni v1',
      'server db01',
      'networkaddress @10/0/0/1',
      'networkaddress[@10/0/0/1] -> server[db01] :AssignedTo {note=primary}',
    ].join('\n'),
  );

  return mount(GraphView, { attachTo: document.body });
}

type GraphExposed = { simNodes: unknown; layout: GraphLayout };

function getSimNodes(wrapper: VueWrapper): SimNode[] {
  // Prefer the simulation source of truth: exposed `simNodes` mirrors this but some
  // test utils unwrap refs inconsistently; `layout.nodes()` always matches the sim.
  return [...(wrapper.vm as unknown as GraphExposed).layout.nodes()];
}

describe('GraphView node drag binding', () => {
  it('exposes a data-sim-id on every node g that resolves to the sim array via simNodeForDrag', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();
    const list = getSimNodes(wrapper);
    const groups = wrapper.findAll('[data-sim-node]');
    expect(groups.length).toBe(list.length);
    for (const g of groups) {
      const el = g.element;
      const id = g.attributes('data-sim-id');
      expect(id).toBeTruthy();
      const resolved = simNodeForDrag(el, list);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(id);
    }
  });

  it('simNodeForDrag on the shape matches the same SimNode as `layout.nodes()` (no d3 datum on Vue `g`s)', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();
    const list = getSimNodes(wrapper);
    const groups = wrapper.findAll('[data-sim-node]');
    expect(list.length).toBeGreaterThan(1);
    const pick = 1;
    const target = list[pick]!;

    const gWrap = groups[pick]!;
    expect(gWrap.attributes('data-sim-id')).toBe(target.id);
    const path = gWrap.find('.tni-graph__node-shape');
    expect(path.exists()).toBe(true);

    const fromDom = simNodeForDrag(path.element, list);
    expect(fromDom).toBe(target);
    fromDom!.fx = 7;
    fromDom!.fy = 8;
    const sameFromLayout = (wrapper.vm as unknown as GraphExposed).layout
      .nodes()
      .find((n) => n.id === target.id);
    expect(sameFromLayout).toBe(target);
    expect(sameFromLayout?.fx).toBe(7);
    expect(sameFromLayout?.fy).toBe(8);
  });

  it('opens inspector on normal node click', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();
    const fsm = useFsmStore();
    expect(fsm.state.kind).toBe('Idle');

    await wrapper.findAll('[data-sim-node]')[0]!.trigger('click');
    expect(fsm.state.kind).toBe('NodeInspectorOpen');
  });

  it('ignores default-prevented node click (drag release path)', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();
    const fsm = useFsmStore();
    expect(fsm.state.kind).toBe('Idle');

    const node = wrapper.findAll('[data-sim-node]')[0]!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    ev.preventDefault();
    node.element.dispatchEvent(ev);
    await wrapper.vm.$nextTick();
    expect(fsm.state.kind).toBe('Idle');
  });
});

describe('GraphView edge hover tooltip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders a transparent hit path for every edge', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();
    const hits = wrapper.findAll('.tni-graph__edge-hit');
    expect(hits.length).toBe(1);
  });

  it('shows edge tooltip on mouseenter of hit path', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();

    const stack = wrapper.find('[data-tni-tooltip-stack]');
    expect(stack.classes()).not.toContain('visible');

    const hit = wrapper.find('.tni-graph__edge-hit');
    await hit.trigger('mouseenter', { clientX: 10, clientY: 10 });

    expect(stack.classes()).toContain('visible');
    const text = wrapper.find('.tni-graph__tooltip--panel').text();
    expect(text).toContain('AssignedTo');
    expect(text).toContain('networkaddress');
    expect(text).toContain('@10/0/0/1');
    expect(text).toContain('server');
    expect(text).toContain('db01');
    expect(text).toContain('note=primary');
    expect(text).toContain('directed');
  });

  it('hides edge tooltip on mouseleave', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();

    const hit = wrapper.find('.tni-graph__edge-hit');
    await hit.trigger('mouseenter', { clientX: 10, clientY: 10 });
    expect(wrapper.find('[data-tni-tooltip-stack]').classes()).toContain('visible');

    await hit.trigger('mouseleave');
    expect(wrapper.find('[data-tni-tooltip-stack]').classes()).not.toContain('visible');
  });

  it('clears node hover when an edge takes focus', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();

    const nodeGroups = wrapper.findAll('[data-sim-node]');
    expect(nodeGroups.length).toBeGreaterThan(0);
    await nodeGroups[0].trigger('mouseenter', { clientX: 5, clientY: 5 });
    // Node tooltip shows its type label.
    expect(wrapper.find('[data-tni-tooltip-stack]').classes()).toContain('visible');

    await wrapper.find('.tni-graph__edge-hit').trigger('mouseenter', {
      clientX: 10,
      clientY: 10,
    });

    // Now the tooltip is the edge's — relation name must be present.
    expect(wrapper.find('.tni-graph__tooltip--panel').text()).toContain('AssignedTo');
  });

  it('applies hover class to the edge group under the cursor', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();

    const edgeGroups = wrapper.findAll('.tni-graph__edges > g');
    expect(edgeGroups.length).toBe(1);
    expect(edgeGroups[0].classes()).not.toContain('hover');

    await wrapper.find('.tni-graph__edge-hit').trigger('mouseenter', {
      clientX: 10,
      clientY: 10,
    });
    expect(wrapper.findAll('.tni-graph__edges > g')[0].classes()).toContain('hover');
  });
});

/**
 * Shift-held tooltip contract: while Shift is physically down (keydown without
 * keyup), no incidental pointer path should hide the tooltip entirely.
 *
 * Regression: moving from a pinned node tooltip toward the stack often crosses
 * an edge hit path; `onEdgeEnter`/`onEdgeLeave` must not wipe the tooltip
 * while Shift remains held.
 */
describe('GraphView tooltip while Shift held', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function mountGraphWithEdge() {
    const fsm = useFsmStore();
    fsm.dispatch({ type: 'loadDone' });
    useGraphStore().parseText(
      [
        '!tni v1',
        'server db01',
        'networkaddress @10/0/0/1',
        'networkaddress[@10/0/0/1] -> server[db01] :AssignedTo {note=primary}',
      ].join('\n'),
    );
    return mount(GraphView, { attachTo: document.body });
  }

  it('keeps tooltip visible after edge leave when Shift is still held (keydown without keyup)', async () => {
    const wrapper = mountGraphWithEdge();
    await wrapper.vm.$nextTick();

    const stack = () => wrapper.find('[data-tni-tooltip-stack]');
    const node = wrapper.findAll('[data-sim-node]')[0]!;
    const hit = wrapper.find('.tni-graph__edge-hit');

    await node.trigger('mouseenter', { clientX: 5, clientY: 5 });
    expect(stack().classes()).toContain('visible');

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Shift',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();

    await hit.trigger('mouseenter', { clientX: 10, clientY: 10 });
    expect(stack().classes()).toContain('visible');

    await hit.trigger('mouseleave');
    await wrapper.vm.$nextTick();

    // Shift still down + pinned node session → edge leave must not hide stack.
    expect(stack().classes()).toContain('visible');
  });

  it('does not replace pinned node tooltip when entering another node while Shift is held', async () => {
    const wrapper = mountGraphWithEdge();
    await wrapper.vm.$nextTick();

    const nodes = wrapper.findAll('[data-sim-node]');
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    const head = () => wrapper.find('.tni-graph__tooltip--panel .tni-tip__head');
    await nodes[0]!.trigger('mouseenter', { clientX: 1, clientY: 1 });
    const labelAfterFirst = head().text();
    expect(labelAfterFirst.length).toBeGreaterThan(0);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Shift',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();

    await nodes[1]!.trigger('mouseenter', { clientX: 2, clientY: 2 });
    await wrapper.vm.$nextTick();

    expect(head().text()).toBe(labelAfterFirst);
    expect(wrapper.find('[data-tni-tooltip-stack]').classes()).toContain('visible');
  });

  it('does not move tooltip stack position on graph mousemove after Shift pin', async () => {
    const wrapper = mountGraphWithEdge();
    await wrapper.vm.$nextTick();

    const stack = wrapper.find('[data-tni-tooltip-stack]');
    const nodes = wrapper.findAll('[data-sim-node]');
    const hit = wrapper.find('.tni-graph__edge-hit');

    await nodes[0]!.trigger('mouseenter', { clientX: 20, clientY: 20 });
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Shift',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const el = stack.element as HTMLElement;
    const left0 = el.style.left;
    const top0 = el.style.top;
    expect(left0.length).toBeGreaterThan(0);

    await nodes[0]!.trigger('mousemove', { clientX: 400, clientY: 300 });
    await wrapper.vm.$nextTick();
    expect(el.style.left).toBe(left0);
    expect(el.style.top).toBe(top0);

    await hit.trigger('mousemove', { clientX: 111, clientY: 222 });
    await wrapper.vm.$nextTick();
    expect(el.style.left).toBe(left0);
    expect(el.style.top).toBe(top0);
  });
});
