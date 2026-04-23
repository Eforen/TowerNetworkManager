import { beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import GraphView from '@/view/GraphView.vue';
import { useGraphStore, useFsmStore } from '@/store';

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

    const tooltip = wrapper.find('.tni-graph__tooltip');
    expect(tooltip.classes()).not.toContain('visible');

    const hit = wrapper.find('.tni-graph__edge-hit');
    await hit.trigger('mouseenter', { clientX: 10, clientY: 10 });

    expect(tooltip.classes()).toContain('visible');
    const text = tooltip.text();
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
    expect(wrapper.find('.tni-graph__tooltip').classes()).toContain('visible');

    await hit.trigger('mouseleave');
    expect(wrapper.find('.tni-graph__tooltip').classes()).not.toContain('visible');
  });

  it('clears node hover when an edge takes focus', async () => {
    const wrapper = makeView();
    await wrapper.vm.$nextTick();

    const nodeGroups = wrapper.findAll('[data-sim-node]');
    expect(nodeGroups.length).toBeGreaterThan(0);
    await nodeGroups[0].trigger('mouseenter', { clientX: 5, clientY: 5 });
    // Node tooltip shows its type label.
    expect(wrapper.find('.tni-graph__tooltip').classes()).toContain('visible');

    await wrapper.find('.tni-graph__edge-hit').trigger('mouseenter', {
      clientX: 10,
      clientY: 10,
    });

    // Now the tooltip is the edge's — relation name must be present.
    expect(wrapper.find('.tni-graph__tooltip').text()).toContain('AssignedTo');
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
