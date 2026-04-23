import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@/format';

const EXAMPLE_TNI = `!tni v1
# Small demo: one customer on floor 1 with a streaming behavior

floor f1
rack r1 floor=f1
switch sw1
server db01 address=10.0.0.5

port 0 RJ45
port 12345 RJ45 #UserPort

customertype casual label="Casual Dweller"
customer organic-goat customertype=casual

usagetype video traversalsPerTick=10
behaviorinsight streaming label="Streaming"
consumerbehavior netplix-streamer insight=streaming usagetype=video
producerbehavior netplix-origin insight=streaming usagetype=video

program database
program media-store pool.provide.main=16

floor[f1] -> rack[r1] :FloorAssignment
rack[r1] -> switch[sw1] :RackAssignment
rack[r1] -> server[db01] :RackAssignment
switch[sw1] -> port[port0] :NIC
port[port0] -> port[12345] :NetworkCableLinkRJ45
customer[organic-goat] -> port[12345] :Owner

server[db01] -> program[database] :Install {amount=2}
`;

describe('format – round trip through the example file', () => {
  it('parses the example without throwing', () => {
    const { graph } = parse(EXAMPLE_TNI);
    expect(graph.stats().nodes).toBeGreaterThan(10);
    expect(graph.stats().edges).toBeGreaterThan(5);
  });

  it('parse -> serialize -> parse yields a structurally equal graph', () => {
    const a = parse(EXAMPLE_TNI).graph;
    const text = serialize(a);
    const b = parse(text).graph;

    expect(b.stats()).toEqual(a.stats());

    // Each node in `a` exists in `b` with the same tag/property map after
    // defaults have been re-applied on both sides.
    for (const [key, nodeA] of a.nodes) {
      const nodeB = b.nodes.get(key);
      expect(nodeB).toBeDefined();
      expect(new Set(nodeB!.tags)).toEqual(new Set(nodeA.tags));
      expect(nodeB!.properties).toEqual(nodeA.properties);
    }

    // Edges compared by id; relation + properties stable.
    for (const [id, edgeA] of a.edges) {
      const edgeB = b.edges.get(id);
      expect(edgeB).toBeDefined();
      expect(edgeB!.relation).toBe(edgeA.relation);
      expect(edgeB!.properties).toEqual(edgeA.properties);
    }
  });

  it('serialize is idempotent byte-for-byte after one canonicalization pass', () => {
    const once = serialize(parse(EXAMPLE_TNI).graph);
    const twice = serialize(parse(once).graph);
    expect(twice).toBe(once);
  });
});
