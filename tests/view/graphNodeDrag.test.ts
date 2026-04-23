import { describe, expect, it } from 'vitest';
import { simNodeForDrag } from '@/view/graphNodeDrag';
import type { SimNode } from '@/view/layout';
import type { NodeKey } from '@/model';

const simServer: SimNode = {
  id: 'server:db01' as NodeKey,
  model: { id: 'db01', type: 'server', tags: [], properties: {} },
  x: 0,
  y: 0,
};

const simNet: SimNode = {
  id: 'networkaddress:@10/0/0/1' as NodeKey,
  model: { id: '@10/0/0/1', type: 'networkaddress', tags: [], properties: {} },
  x: 0,
  y: 0,
};

describe('simNodeForDrag', () => {
  it('returns null when target is null', () => {
    expect(simNodeForDrag(null, [])).toBeNull();
  });

  it('returns null when there is no data-sim-node ancestor', () => {
    const p = document.createElement('p');
    document.body.append(p);
    expect(simNodeForDrag(p, [])).toBeNull();
    p.remove();
  });

  it('returns null when the node group has no data-sim-id', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-sim-node', '');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.append(path);
    document.body.append(g);
    try {
      expect(simNodeForDrag(path, [])).toBeNull();
    } finally {
      g.remove();
    }
  });

  it('resolves the SimNode from a path inside the tagged group', () => {
    const list = [simServer, simNet];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-sim-node', '');
    g.setAttribute('data-sim-id', 'networkaddress:@10/0/0/1');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    g.append(path);
    document.body.append(g);
    try {
      expect(simNodeForDrag(path, list)).toBe(simNet);
      expect(simNodeForDrag(g, list)).toBe(simNet);
    } finally {
      g.remove();
    }
  });

  it('returns null when data-sim-id does not match any sim node', () => {
    const a = simServer;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-sim-node', '');
    g.setAttribute('data-sim-id', 'server:orphan');
    document.body.append(g);
    try {
      expect(simNodeForDrag(g, [a])).toBeNull();
    } finally {
      g.remove();
    }
  });
});
