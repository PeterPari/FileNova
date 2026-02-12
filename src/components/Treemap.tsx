import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface TreemapProps {
    data: any; // hierarchical data
    width: number;
    height: number;
    onNodeClick?: (node: any) => void;
}

export const Treemap = ({ data, width, height, onNodeClick }: TreemapProps) => {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!data || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        const root = d3.hierarchy(data)
            .sum(d => d.value)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        d3.treemap()
            .size([width, height])
            .padding(1)
            (root);

        const nodes = svg.selectAll("g")
            .data(root.leaves() as d3.HierarchyRectangularNode<any>[])
            .join("g")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        // Color scale
        const categories = Array.from(
            new Set(root.leaves().map(d => d.data.category).filter(Boolean))
        );
        const color = d3.scaleOrdinal<string, string>(d3.schemeTableau10).domain(categories);

        nodes.append("rect")
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0))
            .attr("fill", d => {
                // Determine color based on depth or category if available
                // Assuming data has 'category' or using parent name
                if (d.data.category) return color(d.data.category);
                if (d.parent?.data.name) return color(d.parent.data.name);
                return "#69b3a2";
            })
            .attr("opacity", 0.8)
            .style("cursor", onNodeClick ? "pointer" : "default")
            .on("mouseover", function () { d3.select(this).attr("opacity", 1); })
            .on("mouseout", function () { d3.select(this).attr("opacity", 0.8); })
            .on("click", (_event, d) => {
                if (onNodeClick) {
                    onNodeClick(d.data);
                }
            });

        nodes.append("text")
            .attr("x", 4)
            .attr("y", 14)
            .text(d => d.data.name as string)
            .attr("font-size", "10px")
            .attr("fill", "white")
            .attr("clip-path", (_, i) => `url(#clip-${i})`);

        // Clip paths
        nodes.append("clipPath")
            .attr("id", (_, i) => `clip-${i}`)
            .append("rect")
            .attr("width", d => Math.max(0, d.x1 - d.x0))
            .attr("height", d => Math.max(0, d.y1 - d.y0));

        // Tooltip logic can be added here or via title
        nodes.append("title")
            .text(d => `${d.data.name}\n${formatSize(d.value || 0)}`);

    }, [data, width, height]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return <svg ref={svgRef} width={width} height={height} className="rounded-xl overflow-hidden" />;
};
