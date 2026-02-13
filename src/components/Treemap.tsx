import { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { formatFileSize } from '../utils/formatters';

interface TreemapProps {
    data: any; // hierarchical data
    width: number;
    height: number;
    onNodeClick?: (node: any) => void;
}

export const Treemap = ({ data, width, height, onNodeClick }: TreemapProps) => {
    const svgRef = useRef<SVGSVGElement>(null);

    const layout = useMemo(() => {
        if (!data) return null;
        const root = d3.hierarchy(data).sum((d: any) => d.value).sort((a, b) => (b.value || 0) - (a.value || 0));
        d3.treemap().size([width, height]).padding(1)(root);
        const leaves = root.leaves() as d3.HierarchyRectangularNode<any>[];
        const categories = Array.from(new Set(leaves.map(d => d.data.category).filter(Boolean)));
        const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10).domain(categories);
        return { root, leaves, color } as const;
    }, [data, width, height]);

    useEffect(() => {
        if (!layout || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const nodes = svg.selectAll('g').data(layout.leaves).join('g').attr('transform', d => `translate(${d.x0},${d.y0})`);

        nodes.append('rect')
            .attr('width', d => Math.max(0, d.x1 - d.x0))
            .attr('height', d => Math.max(0, d.y1 - d.y0))
            .attr('fill', d => {
                if (d.data.category) return layout.color(d.data.category);
                if (d.parent?.data.name) return layout.color(d.parent.data.name);
                return '#69b3a2';
            })
            .attr('opacity', 0.8)
            .style('cursor', onNodeClick ? 'pointer' : 'default')
            .on('mouseover', function () { d3.select(this).attr('opacity', 1); })
            .on('mouseout', function () { d3.select(this).attr('opacity', 0.8); })
            .on('click', (_event, d) => { if (onNodeClick) onNodeClick(d.data); });

        nodes.append('text')
            .attr('x', 4)
            .attr('y', 14)
            .text(d => d.data.name as string)
            .attr('font-size', '10px')
            .attr('fill', 'white');

        nodes.append('clipPath')
            .attr('id', (_d, i) => `clip-${i}`)
            .append('rect')
            .attr('width', d => Math.max(0, d.x1 - d.x0))
            .attr('height', d => Math.max(0, d.y1 - d.y0));

        nodes.append('title').text(d => `${d.data.name}\n${formatFileSize(d.value || 0)}`);
    }, [layout, onNodeClick]);

    return <svg ref={svgRef} width={width} height={height} className="rounded-xl overflow-hidden" />;
};
