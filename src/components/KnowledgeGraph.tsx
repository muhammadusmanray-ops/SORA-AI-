import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  type: 'entity' | 'source';
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string;
  target: string;
  label: string;
}

interface KnowledgeGraphProps {
  nodes: Node[];
  links: Link[];
}

export default function KnowledgeGraph({ nodes, links }: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#3f3f46')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', d => d.label === 'mentioned_in' ? '4' : '0');

    const linkText = g.append('g')
      .selectAll('text')
      .data(links)
      .join('text')
      .attr('font-size', '7px')
      .attr('fill', '#52525b')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('text-anchor', 'middle')
      .text(d => d.label);

    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => (d.type === 'source' ? 8 : 6))
      .attr('fill', d => (d.type === 'source' ? '#f97316' : '#10b981'))
      .attr('stroke', '#000')
      .attr('stroke-width', 1)
      .call(d3.drag<SVGCircleElement, Node>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    const text = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .attr('font-size', '10px')
      .attr('fill', d => d.type === 'source' ? '#fff' : '#10b981')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('font-weight', d => d.type === 'source' ? 'bold' : 'normal')
      .attr('dx', 12)
      .attr('dy', 4)
      .text(d => d.id.length > 30 ? d.id.substring(0, 30) + '...' : d.id);

    // Add tooltips so full text is visible on hover
    node.append('title').text(d => d.id);
    text.append('title').text(d => d.id);

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as any).x)
        .attr('y1', d => (d.source as any).y)
        .attr('x2', d => (d.target as any).x)
        .attr('y2', d => (d.target as any).y);

      linkText
        .attr('x', d => ((d.source as any).x + (d.target as any).x) / 2)
        .attr('y', d => ((d.source as any).y + (d.target as any).y) / 2);

      node
        .attr('cx', d => d.x!)
        .attr('cy', d => d.y!);

      text
        .attr('x', d => d.x!)
        .attr('y', d => d.y!);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => simulation.stop();
  }, [nodes, links]);

  return (
    <div className="w-full h-full bg-[#0a0a0a] rounded-xl overflow-hidden border border-[#222]">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
